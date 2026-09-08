#include "NeivaWeather.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
    constexpr int32 Side = 8;
    constexpr float CellCm = 450.f;
    constexpr float VolumeHeightCm = 1100.f;
    // A stable world-cell seed prevents all droplets from changing phase when
    // the moving field crosses a cell boundary. This is visual randomness only.
    uint32 CellSeed(const FIntPoint& Cell)
    {
        return uint32(Cell.X) * 73856093u ^ uint32(Cell.Y) * 19349663u ^ 0x63da7421u;
    }
}

ANeivaWeather::ANeivaWeather()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bTickEvenWhenPaused = false;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    RainInstances = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("LocalRain"));
    SetRootComponent(RainInstances);
    RainInstances->SetMobility(EComponentMobility::Movable);
    RainInstances->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RainInstances->SetGenerateOverlapEvents(false);
    RainInstances->SetCastShadow(false);
    RainInstances->SetAffectDistanceFieldLighting(false);
    RainInstances->SetAffectDynamicIndirectLighting(false);
    RainInstances->SetVisibleInRayTracing(false);
    RainInstances->SetReceivesDecals(false);
    RainInstances->SetNumCustomDataFloats(2); // falling height, stable phase
}

void ANeivaWeather::BeginPlay()
{
    Super::BeginPlay();
    Parameters = LoadObject<UMaterialParameterCollection>(nullptr,
        TEXT("/Game/NeivaAssets/Weather/MPC_NeivaWeather.MPC_NeivaWeather"));
    UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr,
        TEXT("/Game/NeivaAssets/Weather/SM_RainStreak.SM_RainStreak"));
    if (!Parameters || !Mesh)
    {
        UE_LOG(LogTemp, Error, TEXT("NeivaWeather: missing generated weather assets; run prepare_weather_editor.py before cooking."));
        SetActorTickEnabled(false);
        return;
    }
    ParameterInstance = GetWorld()->GetParameterCollectionInstance(Parameters);
    if (!ParameterInstance)
    {
        UE_LOG(LogTemp, Error, TEXT("NeivaWeather: material parameter collection instance unavailable."));
        SetActorTickEnabled(false);
        return;
    }
    RainInstances->SetStaticMesh(Mesh);
    const IConsoleVariable* Quality = IConsoleManager::Get().FindConsoleVariable(TEXT("sg.EffectsQuality"));
    const int32 Level = Quality ? FMath::Clamp(Quality->GetInt(), 0, 3) : 2;
    const int32 Counts[] = {2, 4, 6, 8};
    DropsPerColumn = Counts[Level];
    int32 Requested = 0;
    if (FParse::Value(FCommandLine::Get(), TEXT("NeivaRainDrops="), Requested))
        DropsPerColumn = FMath::Clamp(Requested / (Side * Side), 1, 12);
    Columns.SetNum(Side * Side);
    for (int32 Index = 0; Index < Columns.Num() * DropsPerColumn; ++Index)
        RainInstances->AddInstance(FTransform(FVector::ZeroVector));
    FString InitialMode;
    if (FParse::Value(FCommandLine::Get(), TEXT("NeivaWeather="), InitialMode))
    {
        if (InitialMode.Equals(TEXT("rain"), ESearchCase::IgnoreCase)) SetWeatherMode(ENeivaWeatherMode::Rain);
        else if (InitialMode.Equals(TEXT("dry"), ESearchCase::IgnoreCase)) SetWeatherMode(ENeivaWeatherMode::Dry);
    }
    bReady = true;
    FindAtmosphere();
    PublishParameters();
    UE_LOG(LogTemp, Display, TEXT("NeivaWeather: periodic simulation, %d instanced rain streaks; no real-time meteorological feed."), GetRainInstanceCount());
}

void ANeivaWeather::SetWeatherMode(ENeivaWeatherMode Mode)
{
    Cycle.SetMode(Mode == ENeivaWeatherMode::Rain ? NeivaWeather::Mode::Rain :
        Mode == ENeivaWeatherMode::Dry ? NeivaWeather::Mode::Dry : NeivaWeather::Mode::Cycle);
}

float ANeivaWeather::GetRainAmount() const { return float(Cycle.RainAmount()); }
float ANeivaWeather::GetWetness() const { return float(Cycle.Wetness); }
float ANeivaWeather::GetSecondsUntilChange() const { return float(Cycle.SecondsUntilChange()); }
int32 ANeivaWeather::GetRainInstanceCount() const { return RainInstances->GetInstanceCount(); }
FString ANeivaWeather::GetPhaseLabel() const
{
    switch (Cycle.CurrentPhase)
    {
    case NeivaWeather::Phase::Dry: return TEXT("Despejado");
    case NeivaWeather::Phase::Increasing: return TEXT("Comienza a llover");
    case NeivaWeather::Phase::Rain: return TEXT("Lluvia");
    case NeivaWeather::Phase::Decreasing: return TEXT("Escampando");
    }
    return TEXT("Despejado");
}

void ANeivaWeather::PublishParameters()
{
    if (!ParameterInstance) return;
    ParameterInstance->SetScalarParameterValue(TEXT("RainAmount"), GetRainAmount());
    ParameterInstance->SetScalarParameterValue(TEXT("Wetness"), GetWetness());
    ParameterInstance->SetScalarParameterValue(TEXT("RainTime"), float(Cycle.TotalSeconds));
    RainInstances->SetVisibility(GetRainAmount() > .001f);
}

void ANeivaWeather::FindAtmosphere()
{
    for (TActorIterator<ADirectionalLight> It(GetWorld()); It; ++It)
    {
        auto* Light = Cast<UDirectionalLightComponent>(It->GetLightComponent());
        // Optional procedural fill and non-sun lights must retain their own
        // settings. Only the primary physical atmosphere sun is controlled.
        if (!Light || !Light->bAtmosphereSunLight || Light->AtmosphereSunLightIndex != 0 ||
            It->ActorHasTag(TEXT("NeivaProceduralAmbientFill"))) continue;
        Sun = Light;
        DrySunLux = Light->Intensity;
        DrySunColor = Light->GetLightColor();
        break;
    }
    for (TActorIterator<ASkyAtmosphere> It(GetWorld()); It; ++It)
    {
        Atmosphere = It->GetComponent();
        if (!Atmosphere) continue;
        DryMieScale = Atmosphere->MieScatteringScale;
        DryMieAnisotropy = Atmosphere->MieAnisotropy;
        break;
    }
}

void ANeivaWeather::UpdateAtmosphere(bool bRestore)
{
    const float Rain = bRestore ? 0.f : GetRainAmount();
    // A small quantization threshold limits sky LUT invalidation during the
    // transition. No volumetric cloud/fog volume or extra light is allocated.
    const bool bReachedEndpoint = (Rain == 0.f || Rain == 1.f) && Rain != LastAtmosphereRain;
    if (!bRestore && !bReachedEndpoint && FMath::Abs(Rain - LastAtmosphereRain) < .012f) return;
    LastAtmosphereRain = Rain;
    if (IsValid(Sun))
    {
        Sun->SetIntensity(FMath::Lerp(DrySunLux, DrySunLux * .24f, Rain));
        Sun->SetLightColor(FMath::Lerp(DrySunColor, FLinearColor(.84f, .89f, .96f), Rain));
    }
    if (IsValid(Atmosphere))
    {
        Atmosphere->SetMieScatteringScale(FMath::Lerp(DryMieScale, FMath::Max(DryMieScale, 4.5f), Rain));
        Atmosphere->SetMieAnisotropy(FMath::Lerp(DryMieAnisotropy, .65f, Rain));
    }
}

void ANeivaWeather::UpdateColumn(int32 Index)
{
    const FColumn& Column = Columns[Index];
    FRandomStream Random(int32(CellSeed(Column.Key)));
    const float Top = float(FieldCenter.Z) + VolumeHeightCm;
    const float Height = Column.bGroundFound ? FMath::Clamp(Top - Column.GroundZ - 55.f, 0.f, 1600.f) : 0.f;
    const float Base = Column.bGroundFound ? Column.GroundZ + 8.f : float(FieldCenter.Z);
    for (int32 Drop = 0; Drop < DropsPerColumn; ++Drop)
    {
        const FVector Location((Column.Key.X + Random.FRand()) * CellCm,
            (Column.Key.Y + Random.FRand()) * CellCm, Base);
        const FTransform Transform(FRotator(0, Random.FRand() * 360.f, 0), Location,
            FVector(Random.FRandRange(.7f, 1.25f)));
        const int32 Instance = Index * DropsPerColumn + Drop;
        // Actor stays at world origin: these transforms retain world-cell
        // coordinates while walking or driving; rain never rotates with a car.
        RainInstances->UpdateInstanceTransform(Instance, Transform, false, false, true);
        RainInstances->SetCustomDataValue(Instance, 0, Height, false);
        RainInstances->SetCustomDataValue(Instance, 1, Random.FRand(), false);
    }
}

void ANeivaWeather::UpdateField(const FVector& Position, bool bForce)
{
    const FIntPoint NewGrid(FMath::FloorToInt(Position.X / CellCm), FMath::FloorToInt(Position.Y / CellCm));
    const bool bMoved = NewGrid != GridCenter;
    const bool bHeightChanged = FMath::Abs(Position.Z - FieldCenter.Z) > 100.f;
    if (!bMoved && !bForce && !bHeightChanged) return;
    TMap<FIntPoint, FColumn> Previous;
    for (const FColumn& Column : Columns) Previous.Add(Column.Key, Column);
    GridCenter = NewGrid;
    FieldCenter = Position;
    for (int32 Y = 0; Y < Side; ++Y)
        for (int32 X = 0; X < Side; ++X)
        {
            const int32 Index = Y * Side + X;
            const FIntPoint Key(GridCenter.X + X - Side / 2, GridCenter.Y + Y - Side / 2);
            if (const FColumn* Existing = Previous.Find(Key)) Columns[Index] = *Existing;
            else { Columns[Index] = FColumn(); Columns[Index].Key = Key; }
            if (bForce) Columns[Index].bNeedsTrace = true;
            UpdateColumn(Index);
        }
    RainInstances->MarkRenderStateDirty();
}

void ANeivaWeather::TraceColumns(int32 Budget)
{
    FCollisionQueryParams Query(SCENE_QUERY_STAT(NeivaRainShelter), true, this);
    if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0)) Query.AddIgnoredActor(Pawn);
    int32 Done = 0;
    for (int32 Checked = 0; Checked < Columns.Num() && Done < Budget; ++Checked)
    {
        const int32 Index = TraceCursor++ % Columns.Num();
        FColumn& Column = Columns[Index];
        if (!Column.bNeedsTrace) continue;
        ++Done;
        Column.bNeedsTrace = false;
        const FVector Center((Column.Key.X + .5) * CellCm, (Column.Key.Y + .5) * CellCm, FieldCenter.Z);
        FHitResult Hit;
        // Sample from above the city's modelled roofs, not from inside them.
        // One terrain/roof query serves a column's 2–12 droplets. This is an
        // explicit 4.5 m shelter approximation, not per-droplet collision.
        Column.bGroundFound = GetWorld()->LineTraceSingleByChannel(Hit,
            Center + FVector(0, 0, 30000), Center - FVector(0, 0, 2500), ECC_Visibility, Query);
        if (Column.bGroundFound) Column.GroundZ = float(Hit.ImpactPoint.Z);
        UpdateColumn(Index);
    }
    if (Done) RainInstances->MarkRenderStateDirty();
}

void ANeivaWeather::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bReady || !FMath::IsFinite(DeltaSeconds) || DeltaSeconds <= 0 || UGameplayStatics::IsGamePaused(this)) return;
    Cycle.Advance(DeltaSeconds);
    PublishParameters();
    UpdateAtmosphere();
    FieldUpdateSeconds += DeltaSeconds;
    RefreshSeconds += DeltaSeconds;
    if (FieldUpdateSeconds < .05f) return;
    FieldUpdateSeconds = 0;
    if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
    {
        const bool bRefresh = RefreshSeconds >= 2.f;
        UpdateField(Pawn->GetActorLocation(), bRefresh);
        if (bRefresh) RefreshSeconds = 0;
        TraceColumns(16); // bounded: at most 320 roof traces/second, none per drop
    }
}

void ANeivaWeather::EndPlay(const EEndPlayReason::Type Reason)
{
    UpdateAtmosphere(true);
    if (ParameterInstance)
    {
        ParameterInstance->SetScalarParameterValue(TEXT("RainAmount"), 0);
        ParameterInstance->SetScalarParameterValue(TEXT("Wetness"), 0);
    }
    Super::EndPlay(Reason);
}
