#include "NeivaWorld.h"

#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "ProceduralMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    bool Origin(const TSharedPtr<FJsonObject>& Object, FVector2D& Out)
    {
        const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
        if (!Object.IsValid() || !Object->TryGetArrayField(TEXT("origin"), Values) || Values->Num() != 2) return false;
        if ((*Values)[0]->Type != EJson::Number || (*Values)[1]->Type != EJson::Number) return false;
        Out = FVector2D((*Values)[0]->AsNumber(), (*Values)[1]->AsNumber());
        return FMath::IsFinite(Out.X) && FMath::IsFinite(Out.Y);
    }
}

void ANeivaCity::BuildEnvironment(const TSharedPtr<FJsonObject>& MapData)
{
    FString Raw;
    TSharedPtr<FJsonObject> Data;
    if (!FFileHelper::LoadFileToString(Raw, *(FPaths::ProjectContentDir() / TEXT("Data/neiva-environment.json"))) ||
        !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), Data) || !Data.IsValid())
    {
        UE_LOG(LogTemp, Warning, TEXT("Neiva: environment placements missing; run prepare_environment.py."));
        return;
    }
    const TSharedPtr<FJsonObject>* Meta = nullptr;
    FVector2D SourceOrigin, MapOrigin;
    double Version = 0;
    FString Units;
    if (!Data->TryGetNumberField(TEXT("schemaVersion"), Version) || Version != 1 ||
        !Data->TryGetStringField(TEXT("units"), Units) || Units != TEXT("metres") ||
        !MapData->TryGetObjectField(TEXT("meta"), Meta) || !Origin(Data, SourceOrigin) || !Origin(*Meta, MapOrigin) ||
        !SourceOrigin.Equals(MapOrigin, 1.e-8))
    {
        UE_LOG(LogTemp, Error, TEXT("Neiva: incompatible environment coordinates; no instances created."));
        return;
    }
    const auto* Settings = GetDefault<UNeivaVisualSettings>();
    int32 Counts[2] = {0, 0};
    for (int32 Kind = 0; Kind < 2; ++Kind)
    {
        const TCHAR* Key = Kind == 0 ? TEXT("trees") : TEXT("benches");
        const TArray<TSharedPtr<FJsonValue>>* Entries = nullptr;
        if (!Data->TryGetArrayField(Key, Entries) || Entries->Num() > 256) continue;
        UStaticMesh* Asset = (Kind == 0 ? Settings->TreeMesh : Settings->BenchMesh).LoadSynchronous();
        if (!Asset)
        {
            UE_LOG(LogTemp, Warning, TEXT("Neiva: import visual assets before placing %s."), Key);
            continue;
        }
        const FBox Bounds = Asset->GetBoundingBox();
        const double Height = Bounds.GetSize().Z;
        if (!Bounds.IsValid || !FMath::IsFinite(Height) || Height < 1) continue;
        TArray<FTransform> Transforms;
        for (const auto& Value : *Entries)
        {
            if (!Value.IsValid() || Value->Type != EJson::Object) continue;
            const auto Entry = Value->AsObject();
            double X = 0, Z = 0, Ground = 0, Yaw = 0, HeightM = 0;
            if (!Entry->TryGetNumberField(TEXT("x"), X) || !Entry->TryGetNumberField(TEXT("z"), Z) ||
                !Entry->TryGetNumberField(TEXT("groundM"), Ground) || !Entry->TryGetNumberField(TEXT("yaw"), Yaw) ||
                !Entry->TryGetNumberField(TEXT("heightM"), HeightM) ||
                !FMath::IsFinite(X) || !FMath::IsFinite(Z) || !FMath::IsFinite(Ground) || !FMath::IsFinite(Yaw) ||
                !FMath::IsFinite(HeightM) || HeightM < .3 || HeightM > 30 || FMath::Abs(X) > 20000 ||
                FMath::Abs(Z) > 20000 || FMath::Abs(Ground) > 50) continue;
            const double Scale = HeightM * 100. / Height;
            Transforms.Emplace(FRotator(0, Yaw, 0), FVector(X * 100, -Z * 100, Ground * 100 - Bounds.Min.Z * Scale), FVector(Scale));
        }
        if (Transforms.IsEmpty()) continue;
        auto* Instances = NewObject<UHierarchicalInstancedStaticMeshComponent>(this,
            Kind == 0 ? TEXT("ParqueArboles") : TEXT("ParqueBancos"));
        Instances->SetupAttachment(Mesh);
        Instances->SetMobility(EComponentMobility::Static);
        Instances->SetStaticMesh(Asset);
        Instances->SetCollisionProfileName(TEXT("BlockAll"));
        // Imported collision represents trunks/seat, never the entire canopy.
        Instances->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
        Instances->SetCastShadow(true);
        AddInstanceComponent(Instances);
        Instances->RegisterComponent();
        Instances->AddInstances(Transforms, false, false, true);
        Counts[Kind] = Transforms.Num();
    }
    UE_LOG(LogTemp, Display, TEXT("Neiva: environment %d trees, %d benches; placements/heights/species are interpreted, not individually surveyed."), Counts[0], Counts[1]);
}
