#include "NeivaBakedLandmarks.h"

#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/StrongObjectPtr.h"

namespace
{
    TAutoConsoleVariable<int32> CVarNeivaBakedLandmarks(TEXT("neiva.BakedLandmarks"), 1,
        TEXT("Use complete validated offline landmark meshes. 0 keeps the procedural comparison path."));
    using FNumbers = TArray<TSharedPtr<FJsonValue>>;

    bool Numbers(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name, int32 Count, const FNumbers*& Out)
    {
        if (!Object.IsValid() || !Object->TryGetArrayField(Name, Out) || Out->Num() != Count) return false;
        for (const auto& Value : *Out)
            if (Value->Type != EJson::Number || !FMath::IsFinite(Value->AsNumber())) return false;
        return true;
    }

    FVector Convert(const FNumbers& Values, int32 Offset, double Scale)
    {
        return FVector(Values[Offset]->AsNumber(), -Values[Offset + 2]->AsNumber(),
            Values[Offset + 1]->AsNumber()) * Scale;
    }

    bool Reject(const TCHAR* Reason)
    {
        UE_LOG(LogTemp, Warning, TEXT("Neiva baked landmarks: %s; keeping procedural geometry."), Reason);
        return false;
    }
}

bool Neiva::TryBuildBakedLandmarks(AActor* Owner, USceneComponent* Parent,
    const TSharedPtr<FJsonObject>& MapData, TSet<FString>& ReplacedBuildingIds)
{
    if (!Owner || !Parent || !MapData.IsValid() || CVarNeivaBakedLandmarks.GetValueOnGameThread() == 0) return false;
    FString Raw;
    const FString Directory = FPaths::ProjectContentDir() / TEXT("Data");
    if (!FFileHelper::LoadFileToString(Raw, *(Directory / TEXT("neiva-landmarks-baked.json")))) return false;
    TSharedPtr<FJsonObject> Manifest;
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), Manifest) || !Manifest.IsValid())
        return Reject(TEXT("invalid manifest"));
    const FNumbers *Origin = nullptr, *MapOrigin = nullptr, *Parts = nullptr, *Ids = nullptr, *Labels = nullptr;
    const TSharedPtr<FJsonObject>* Meta = nullptr;
    double Version = 0, ExpectedTriangles = 0, SourceCount = 0;
    bool Complete = false;
    FString Units, Sha1, AssetRoot;
    if (!Manifest->TryGetNumberField(TEXT("schemaVersion"), Version) || Version != 1 ||
        !Manifest->TryGetBoolField(TEXT("complete"), Complete) || !Complete ||
        !Manifest->TryGetStringField(TEXT("units"), Units) || Units != TEXT("centimetres") ||
        !Manifest->TryGetStringField(TEXT("sourceSha1"), Sha1) || Sha1.Len() != 40 ||
        !Manifest->TryGetStringField(TEXT("assetRoot"), AssetRoot) ||
        !AssetRoot.StartsWith(TEXT("/Game/NeivaAssets/BakedLandmarks/Bake_")) ||
        AssetRoot.Contains(TEXT("..")) || AssetRoot.Contains(TEXT("\\")) ||
        !Numbers(Manifest, TEXT("origin"), 2, Origin) ||
        !MapData->TryGetObjectField(TEXT("meta"), Meta) || !Numbers(*Meta, TEXT("origin"), 2, MapOrigin) ||
        !FMath::IsNearlyEqual((*Origin)[0]->AsNumber(), (*MapOrigin)[0]->AsNumber(), 1.e-8) ||
        !FMath::IsNearlyEqual((*Origin)[1]->AsNumber(), (*MapOrigin)[1]->AsNumber(), 1.e-8) ||
        !Manifest->TryGetNumberField(TEXT("triangleCount"), ExpectedTriangles) || ExpectedTriangles <= 0 ||
        !Manifest->TryGetNumberField(TEXT("sourceMeshCount"), SourceCount) || SourceCount <= 0 ||
        !Manifest->TryGetArrayField(TEXT("parts"), Parts) || Parts->IsEmpty() || Parts->Num() > 4096 ||
        !Manifest->TryGetArrayField(TEXT("replacesBuildingIds"), Ids) || Ids->IsEmpty() ||
        !Manifest->TryGetArrayField(TEXT("textLabels"), Labels) || Labels->Num() > 1024)
        return Reject(TEXT("incomplete or incompatible manifest"));
    TArray<uint8> Source;
    if (!FFileHelper::LoadFileToArray(Source, *(Directory / TEXT("neiva-landmarks.json"))) ||
        !FSHA1::HashBuffer(Source.GetData(), Source.Num()).ToString().Equals(Sha1, ESearchCase::IgnoreCase))
        return Reject(TEXT("landmark source changed; rebake required"));
    Source.Empty();

    // Hold every asset strongly and validate every transform before creating any
    // component. Partial asset installation cannot leave half a landmark visible.
    TArray<TStrongObjectPtr<UStaticMesh>> Meshes;
    TSet<FString> SeenAssets, Replaced;
    TSet<int32> SeenSources;
    int64 TriangleCount = 0;
    int32 NaniteCount = 0;
    for (const auto& Value : *Ids)
    {
        if (Value->Type != EJson::String || Value->AsString().IsEmpty() || Replaced.Contains(Value->AsString()))
            return Reject(TEXT("invalid replacement IDs"));
        Replaced.Add(Value->AsString());
    }
    for (const auto& Value : *Parts)
    {
        const auto Part = Value->AsObject();
        const FNumbers* Pivot = nullptr;
        FString Asset;
        double Triangles = 0, SourceIndex = 0;
        bool Collision = false, Nanite = false;
        if (!Part.IsValid() || !Numbers(Part, TEXT("pivotCm"), 3, Pivot) ||
            !Part->TryGetStringField(TEXT("asset"), Asset) || !Asset.StartsWith(AssetRoot + TEXT("/SM_Landmark_")) ||
            Asset.Contains(TEXT("..")) || Asset.Contains(TEXT("\\")) || SeenAssets.Contains(Asset) ||
            !Part->TryGetNumberField(TEXT("triangleCount"), Triangles) || Triangles <= 0 ||
            !Part->TryGetNumberField(TEXT("sourceMesh"), SourceIndex) || SourceIndex < 0 || SourceIndex >= SourceCount ||
            SourceIndex != std::floor(SourceIndex) ||
            !Part->TryGetBoolField(TEXT("collision"), Collision) || !Part->TryGetBoolField(TEXT("nanite"), Nanite))
            return Reject(TEXT("invalid part"));
        const FString ObjectPath = Asset + TEXT(".") + FPackageName::GetLongPackageAssetName(Asset);
        UStaticMesh* StaticMesh = LoadObject<UStaticMesh>(nullptr, *ObjectPath);
        if (!StaticMesh || !StaticMesh->GetMaterial(0) || StaticMesh->GetNumTriangles(0) != Triangles ||
            (Nanite && !StaticMesh->HasValidNaniteData()))
            return Reject(TEXT("missing or incompatible baked mesh/material/Nanite resource"));
        Meshes.Emplace(StaticMesh);
        SeenAssets.Add(Asset); SeenSources.Add(static_cast<int32>(SourceIndex));
        TriangleCount += StaticMesh->GetNumTriangles(0);
        NaniteCount += StaticMesh->HasValidNaniteData() ? 1 : 0;
    }
    if (TriangleCount != ExpectedTriangles || SeenSources.Num() != SourceCount)
        return Reject(TEXT("triangle/section totals changed"));
    for (const auto& Value : *Labels)
    {
        const auto Label = Value->AsObject();
        const FNumbers* Matrix = nullptr;
        FString Text;
        double Height = 0;
        if (!Label.IsValid() || !Numbers(Label, TEXT("worldMatrix"), 16, Matrix) ||
            !Label->TryGetStringField(TEXT("text"), Text) || Text.Len() > 512 ||
            !Label->TryGetNumberField(TEXT("heightM"), Height) || !FMath::IsFinite(Height) || Height <= 0)
            return Reject(TEXT("invalid text label"));
    }

    for (int32 Index = 0; Index < Parts->Num(); ++Index)
    {
        const auto Part = (*Parts)[Index]->AsObject();
        const auto& Pivot = Part->GetArrayField(TEXT("pivotCm"));
        const bool Collision = Part->GetBoolField(TEXT("collision"));
        auto* Component = NewObject<UStaticMeshComponent>(Owner,
            *FString::Printf(TEXT("BakedLandmark_%03d"), Index));
        Component->SetupAttachment(Parent);
        Component->SetMobility(EComponentMobility::Static);
        Component->SetRelativeLocation(FVector(Pivot[0]->AsNumber(), Pivot[1]->AsNumber(), Pivot[2]->AsNumber()));
        Component->SetStaticMesh(Meshes[Index].Get());
        Component->SetCollisionProfileName(Collision ? TEXT("BlockAll") : TEXT("NoCollision"));
        Component->SetCastShadow(Collision);
        Component->bAffectDistanceFieldLighting = Collision;
        Owner->AddInstanceComponent(Component);
        Component->RegisterComponent();
    }
    for (const auto& Value : *Labels)
    {
        const auto SourceLabel = Value->AsObject();
        const auto& Matrix = SourceLabel->GetArrayField(TEXT("worldMatrix"));
        FString Color;
        SourceLabel->TryGetStringField(TEXT("foreground"), Color);
        auto* Label = NewObject<UTextRenderComponent>(Owner);
        Label->SetupAttachment(Parent); Label->SetMobility(EComponentMobility::Static);
        Label->SetRelativeLocation(Convert(Matrix, 12, 100));
        Label->SetRelativeRotation(FRotationMatrix::MakeFromXZ(Convert(Matrix, 8, 1), FVector::UpVector).Rotator());
        Label->SetHorizontalAlignment(EHorizTextAligment::EHTA_Center);
        Label->SetVerticalAlignment(EVerticalTextAligment::EVRTA_TextCenter);
        Label->SetWorldSize(SourceLabel->GetNumberField(TEXT("heightM")) * 100);
        Label->SetText(FText::FromString(SourceLabel->GetStringField(TEXT("text"))));
        Label->SetTextRenderColor(FColor::FromHex(Color));
        Owner->AddInstanceComponent(Label); Label->RegisterComponent();
    }
    ReplacedBuildingIds = MoveTemp(Replaced);
    UE_LOG(LogTemp, Display, TEXT("Neiva baked landmarks: %d static parts, %d Nanite, %lld source triangles, %d labels; source hash verified."),
        Parts->Num(), NaniteCount, TriangleCount, Labels->Num());
    return true;
}
