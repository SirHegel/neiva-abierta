#include "NeivaWorld.h"

#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "NeivaProceduralTangents.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "ProceduralMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    using FNumbers = TArray<TSharedPtr<FJsonValue>>;
    bool Numbers(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key, int32 Multiple, const FNumbers*& Out)
    {
        if (!Object->TryGetArrayField(Key, Out) || Out->IsEmpty() || Out->Num() % Multiple != 0) return false;
        for (const auto& Value : *Out)
            if (Value->Type != EJson::Number || !FMath::IsFinite(Value->AsNumber())) return false;
        return true;
    }
    FVector Convert(const FNumbers& Values, int32 Offset, double Scale)
    {
        return FVector(Values[Offset]->AsNumber(), -Values[Offset + 2]->AsNumber(),
            Values[Offset + 1]->AsNumber()) * Scale;
    }
}

TSet<FString> ANeivaCity::BuildLandmarks(const TSharedPtr<FJsonObject>& MapData)
{
    TSet<FString> Replaced;
    FString Raw;
    TSharedPtr<FJsonObject> Data;
    const FString File = FPaths::ProjectContentDir() / TEXT("Data/neiva-landmarks.json");
    if (!FFileHelper::LoadFileToString(Raw, *File) ||
        !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), Data) || !Data.IsValid())
    {
        UE_LOG(LogTemp, Warning, TEXT("Neiva: detailed landmarks unavailable; run prepare_project.py. Keeping footprint geometry."));
        return Replaced;
    }
    Raw.Empty();
    const FNumbers *Origin = nullptr, *MapOrigin = nullptr, *Meshes = nullptr;
    const TSharedPtr<FJsonObject>* Meta = nullptr;
    double Version = 0;
    FString Units;
    if (!Data->TryGetNumberField(TEXT("schemaVersion"), Version) || Version != 1 ||
        !Data->TryGetStringField(TEXT("units"), Units) || Units != TEXT("metres") ||
        !Numbers(Data, TEXT("origin"), 2, Origin) || Origin->Num() != 2 ||
        !MapData->TryGetObjectField(TEXT("meta"), Meta) || !Numbers(*Meta, TEXT("origin"), 2, MapOrigin) ||
        MapOrigin->Num() != 2 || !FMath::IsNearlyEqual((*Origin)[0]->AsNumber(), (*MapOrigin)[0]->AsNumber(), 1.e-8) ||
        !FMath::IsNearlyEqual((*Origin)[1]->AsNumber(), (*MapOrigin)[1]->AsNumber(), 1.e-8) ||
        !Data->TryGetArrayField(TEXT("meshes"), Meshes) || Meshes->IsEmpty())
    { UE_LOG(LogTemp, Error, TEXT("Neiva: incompatible landmark schema/origin; nothing replaced.")); return Replaced; }

    // Validate every mesh before replacing any mapped building. An incomplete
    // export must never remove its original footprint and leave an invisible gap.
    TMap<FString, UMaterialInterface*> Parents;
    for (const auto& Value : *Meshes)
    {
        const auto O = Value->AsObject();
        const FNumbers *P = nullptr, *N = nullptr, *UV = nullptr, *I = nullptr, *C = nullptr, *Tile = nullptr;
        FString Key;
        if (!O.IsValid() || !Numbers(O, TEXT("positions"), 3, P) || !Numbers(O, TEXT("normals"), 3, N) ||
            !Numbers(O, TEXT("uv"), 2, UV) || !Numbers(O, TEXT("indices"), 3, I) ||
            !Numbers(O, TEXT("color"), 3, C) || C->Num() != 3 ||
            N->Num() != P->Num() || UV->Num() / 2 != P->Num() / 3 || !O->TryGetStringField(TEXT("material"), Key))
        { UE_LOG(LogTemp, Error, TEXT("Neiva: invalid landmark vertex arrays; nothing replaced.")); return {}; }
        for (const auto& Index : *I)
            if (Index->AsNumber() < 0 || Index->AsNumber() >= P->Num() / 3 ||
                Index->AsNumber() != std::floor(Index->AsNumber()))
            { UE_LOG(LogTemp, Error, TEXT("Neiva: invalid landmark index; nothing replaced.")); return {}; }
        const bool Textured = Key == TEXT("brick") || Key == TEXT("plaster") || Key == TEXT("roof") || Key == TEXT("pavement");
        const bool HasTile = O->TryGetArrayField(TEXT("uvTileMeters"), Tile);
        if ((Textured || HasTile) && (!Numbers(O, TEXT("uvTileMeters"), 2, Tile) || Tile->Num() != 2 ||
            (*Tile)[0]->AsNumber() <= 0 || (*Tile)[1]->AsNumber() <= 0))
        { UE_LOG(LogTemp, Error, TEXT("Neiva: invalid landmark physical UV scale; nothing replaced.")); return {}; }
        const FString Name = Textured ? TEXT("M_Landmark_") + Key : TEXT("M_LandmarkSolid");
        if (!Parents.Contains(Key))
        {
            const FString Asset = FString::Printf(TEXT("/Game/NeivaAssets/Materials/%s.%s"), *Name, *Name);
            auto* Parent = LoadObject<UMaterialInterface>(nullptr, *Asset);
            if (!Parent) { UE_LOG(LogTemp, Error, TEXT("Neiva: missing %s; run bootstrap_editor.py."), *Asset); return {}; }
            Parents.Add(Key, Parent);
        }
    }

    int32 Count = 0;
    for (const auto& Value : *Meshes)
    {
        const auto O = Value->AsObject();
        const auto& P = O->GetArrayField(TEXT("positions"));
        const auto& N = O->GetArrayField(TEXT("normals"));
        const auto& RawUV = O->GetArrayField(TEXT("uv"));
        const auto& RawIndices = O->GetArrayField(TEXT("indices"));
        const FNumbers* Tile = nullptr;
        O->TryGetArrayField(TEXT("uvTileMeters"), Tile);
        const double TileU = Tile ? (*Tile)[0]->AsNumber() : 1;
        const double TileV = Tile ? (*Tile)[1]->AsNumber() : 1;
        const auto& Color = O->GetArrayField(TEXT("color"));
        TArray<FVector> Vertices, Normals;
        TArray<FVector2D> UV;
        TArray<int32> Indices;
        TArray<FLinearColor> Colors;
        TArray<FProcMeshTangent> Tangents;
        const FLinearColor Tint(Color[0]->AsNumber(), Color[1]->AsNumber(), Color[2]->AsNumber(), 1);
        for (int32 Index = 0; Index < P.Num() / 3; ++Index)
        {
            Vertices.Add(Convert(P, Index * 3, 100));
            Normals.Add(Convert(N, Index * 3, 1).GetSafeNormal());
            // Source TextureLoader flips images for bottom-origin Three UVs.
            // Native image UVs start at the top; flip V exactly once here.
            UV.Add(FVector2D(RawUV[Index * 2]->AsNumber() / TileU,
                1 - RawUV[Index * 2 + 1]->AsNumber() / TileV));
            Colors.Add(Tint);
        }
        for (const auto& Index : RawIndices) Indices.Add(static_cast<int32>(Index->AsNumber()));
        // (x,y,z) -> (x,-z,y) is a rotation with determinant +1. Three's
        // counterclockwise indices therefore still need reversal for PMC's
        // clockwise fronts. Keep the converted authored normals unchanged.
        for (int32 Index = 0; Index + 2 < Indices.Num(); Index += 3)
            Swap(Indices[Index + 1], Indices[Index + 2]);
        // Tangents share indices only; preserve authored normals and hard edges.
        Neiva::CalculateTangents(Vertices, Indices, UV, Normals, Tangents);
        auto* Component = NewObject<UProceduralMeshComponent>(this,
            *FString::Printf(TEXT("Landmark_%d"), Count++));
        Component->SetupAttachment(Mesh);
        Component->SetMobility(EComponentMobility::Static);
        Component->bUseAsyncCooking = false;
        Component->bUseComplexAsSimpleCollision = true;
        AddInstanceComponent(Component); BuildingMeshes.Add(Component); Component->RegisterComponent();
        FString Key; O->TryGetStringField(TEXT("material"), Key);
        const bool Collision = Key != TEXT("water");
        Component->CreateMeshSection_LinearColor(0, Vertices, Indices, Normals, UV, Colors, Tangents, Collision);
        auto* Material = UMaterialInstanceDynamic::Create(Parents[Key], Component);
        double Roughness = .8, Metalness = 0;
        O->TryGetNumberField(TEXT("roughness"), Roughness); O->TryGetNumberField(TEXT("metalness"), Metalness);
        Material->SetScalarParameterValue(TEXT("RoughnessScale"), FMath::Clamp(Roughness, .04, 1.0));
        Material->SetScalarParameterValue(TEXT("Metalness"), FMath::Clamp(Metalness, 0.0, 1.0));
        Component->SetMaterial(0, Material);
        FString BuildingId;
        if (O->TryGetStringField(TEXT("buildingId"), BuildingId)) Replaced.Add(BuildingId);
    }
    const FNumbers* Labels = nullptr;
    if (Data->TryGetArrayField(TEXT("textLabels"), Labels))
        for (const auto& Value : *Labels)
        {
            const auto O = Value->AsObject();
            const FNumbers* Matrix = nullptr;
            FString Text, Color;
            double Height = .5;
            if (!O.IsValid() || !Numbers(O, TEXT("worldMatrix"), 16, Matrix) || Matrix->Num() != 16 ||
                !O->TryGetStringField(TEXT("text"), Text)) continue;
            O->TryGetStringField(TEXT("foreground"), Color); O->TryGetNumberField(TEXT("heightM"), Height);
            auto* Label = NewObject<UTextRenderComponent>(this);
            Label->SetupAttachment(Mesh); Label->SetMobility(EComponentMobility::Static);
            Label->SetRelativeLocation(Convert(*Matrix, 12, 100));
            Label->SetRelativeRotation(FRotationMatrix::MakeFromXZ(Convert(*Matrix, 8, 1), FVector::UpVector).Rotator());
            Label->SetHorizontalAlignment(EHorizTextAligment::EHTA_Center);
            Label->SetVerticalAlignment(EVerticalTextAligment::EVRTA_TextCenter);
            Label->SetWorldSize(Height * 100); Label->SetText(FText::FromString(Text));
            Label->SetTextRenderColor(FColor::FromHex(Color));
            AddInstanceComponent(Label); Label->RegisterComponent();
        }
    UE_LOG(LogTemp, Display, TEXT("Neiva: %d detailed landmark sections replace %d footprints; facade interpretations, not photogrammetry."), Count, Replaced.Num());
    return Replaced;
}
