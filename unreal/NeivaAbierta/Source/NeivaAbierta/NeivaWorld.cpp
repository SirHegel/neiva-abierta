#include "NeivaWorld.h"

#include "Algo/Reverse.h"
#include "Animation/AnimSequence.h"
#include "Camera/CameraComponent.h"
#include "CollisionQueryParams.h"
#include "CollisionShape.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/InputComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/Canvas.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/SkyLight.h"
#include "Engine/SkyAtmosphere.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureCube.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/TouchInterface.h"
#include "HAL/PlatformProcess.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace Neiva
{
    const TCHAR* ContactURL = TEXT("mailto:alvarezruizj289@gmail.com?subject=Desarrollo%20desde%20Neiva%20Abierta");

    struct FGeometry
    {
        TArray<FVector> Vertices;
        TArray<int32> Indices;
        TArray<FVector> Normals;
        TArray<FVector2D> UVs;
        TArray<FLinearColor> Colors;

        void Triangle(FVector A, FVector B, FVector C, FLinearColor Color)
        {
            const FVector Normal = FVector::CrossProduct(B - A, C - A).GetSafeNormal();
            if (Normal.IsNearlyZero()) return;
            for (const FVector& P : {A, B, C})
            {
                Indices.Add(Vertices.Num());
                Vertices.Add(P);
                Normals.Add(Normal);
                // Dominant-plane UVs: 1 UV = 1 metre, including vertical walls.
                // Split vertices retain flat normals; normal maps use derived tangents.
                const FVector N = Normal.GetAbs();
                const FVector2D UV = N.Z >= N.X && N.Z >= N.Y ? FVector2D(P.X, P.Y)
                    : N.X >= N.Y ? FVector2D(P.Y, P.Z) : FVector2D(P.X, P.Z);
                UVs.Add(UV / 100.0);
                Colors.Add(Color);
            }
        }

        void Quad(FVector A, FVector B, FVector C, FVector D, FLinearColor Color)
        {
            Triangle(A, B, C, Color);
            Triangle(A, C, D, Color);
        }

        void Upload(UProceduralMeshComponent* Mesh, int32 Index, UMaterialInterface* Material, bool Collision)
        {
            if (Vertices.IsEmpty()) return;
            TArray<FProcMeshTangent> Tangents;
            UKismetProceduralMeshLibrary::CalculateTangentsForMesh(Vertices, Indices, UVs, Normals, Tangents);
            Mesh->CreateMeshSection_LinearColor(Index, Vertices, Indices, Normals, UVs,
                Colors, Tangents, Collision);
            if (Material) Mesh->SetMaterial(Index, Material);
        }
    };

    // Data axes: x east, z south, meters. Unreal: X east, Y north, Z up, cm.
    FVector ReadPoint(const TSharedPtr<FJsonValue>& Value, double Height = 0)
    {
        if (!Value.IsValid()) return FVector(0, 0, Height);
        if (Value->Type == EJson::Array)
        {
            const auto& V = Value->AsArray();
            if (V.Num() >= 2) return FVector(V[0]->AsNumber() * 100, -V[1]->AsNumber() * 100, Height);
        }
        if (Value->Type == EJson::Object)
        {
            const auto O = Value->AsObject();
            double X = 0, Z = 0;
            O->TryGetNumberField(TEXT("x"), X);
            O->TryGetNumberField(TEXT("z"), Z);
            return FVector(X * 100, -Z * 100, Height);
        }
        return FVector(0, 0, Height);
    }

    TArray<FVector> Points(const TSharedPtr<FJsonObject>& Object, double Height = 0)
    {
        TArray<FVector> Result;
        const TArray<TSharedPtr<FJsonValue>>* Raw = nullptr;
        if (!Object.IsValid() || !Object->TryGetArrayField(TEXT("points"), Raw)) return Result;
        for (const auto& V : *Raw)
        {
            FVector P = ReadPoint(V, Height);
            if (Result.IsEmpty() || !P.Equals(Result.Last(), 0.1)) Result.Add(P);
        }
        if (Result.Num() > 2 && Result[0].Equals(Result.Last(), 0.1)) Result.Pop();
        return Result;
    }

    double Cross2(FVector A, FVector B, FVector C)
    {
        return (B.X - A.X) * (C.Y - A.Y) - (B.Y - A.Y) * (C.X - A.X);
    }

    void Face(FGeometry& G, TArray<FVector> P, FLinearColor Color)
    {
        if (P.Num() < 3) return;
        double Area = 0;
        for (int32 I = 0; I < P.Num(); ++I)
        {
            const FVector& B = P[(I + 1) % P.Num()];
            Area += P[I].X * B.Y - B.X * P[I].Y;
        }
        if (Area < 0) Algo::Reverse(P);
        // Ear clipping supports concave OSM footprints; invalid rings are skipped.
        int32 Guard = P.Num() * P.Num();
        while (P.Num() > 2 && Guard-- > 0)
        {
            bool Removed = false;
            for (int32 I = 0; I < P.Num(); ++I)
            {
                const int32 Prev = (I + P.Num() - 1) % P.Num();
                const int32 Next = (I + 1) % P.Num();
                const FVector A = P[Prev], B = P[I], C = P[Next];
                const double Turn = Cross2(A, B, C);
                if (FMath::Abs(Turn) < 0.01)
                {
                    P.RemoveAt(I); Removed = true; break;
                }
                if (Turn < 0) continue;
                bool Occupied = false;
                for (int32 J = 0; J < P.Num(); ++J)
                {
                    if (J == I || J == Prev || J == Next) continue;
                    if (Cross2(A, B, P[J]) >= 0 && Cross2(B, C, P[J]) >= 0 && Cross2(C, A, P[J]) >= 0)
                    { Occupied = true; break; }
                }
                if (!Occupied)
                {
                    G.Triangle(A, B, C, Color);
                    P.RemoveAt(I); Removed = true; break;
                }
            }
            if (!Removed) break;
        }
    }

    void Extrude(FGeometry& G, TArray<FVector> P, double Height, FLinearColor Color, FGeometry* Roof = nullptr)
    {
        if (P.Num() < 3) return;
        double Area = 0;
        for (int32 I = 0; I < P.Num(); ++I)
        {
            const FVector B = P[(I + 1) % P.Num()];
            Area += P[I].X * B.Y - B.X * P[I].Y;
        }
        if (Area < 0) Algo::Reverse(P);
        for (int32 I = 0; I < P.Num(); ++I)
        {
            const FVector A = P[I], B = P[(I + 1) % P.Num()];
            const FVector Up(0, 0, Height);
            G.Quad(A, B, B + Up, A + Up, Color);
        }
        for (FVector& V : P) V.Z += Height;
        Face(Roof ? *Roof : G, P, Color);
    }

    void Ribbon(FGeometry& G, const TArray<FVector>& P, double Width, FLinearColor Color)
    {
        for (int32 I = 1; I < P.Num(); ++I)
        {
            FVector D = P[I] - P[I - 1];
            D.Z = 0;
            const FVector Side = FVector(-D.Y, D.X, 0).GetSafeNormal() * Width * 0.5;
            G.Quad(P[I - 1] - Side, P[I] - Side, P[I] + Side, P[I - 1] + Side, Color);
        }
    }

    bool Canopy(const TSharedPtr<FJsonObject>& O, FGeometry& Supports, FGeometry& Roofs, double Height)
    {
        const TSharedPtr<FJsonObject>* Structure = nullptr;
        if (!O->TryGetObjectField(TEXT("structure"), Structure)) return false;
        FString Kind; (*Structure)->TryGetStringField(TEXT("kind"), Kind);
        if (Kind != TEXT("open-canopy")) return false;
        double Thickness = .28; (*Structure)->TryGetNumberField(TEXT("roofThickness"), Thickness);
        Thickness = FMath::Clamp(Thickness, .08, Height);
        const auto Base = Points(O, (Height - Thickness) * 100);
        Extrude(Roofs, Base, Thickness * 100, FLinearColor::White);
        FGeometry Underside; Face(Underside, Base, FLinearColor::White);
        for (int32 I = 0; I + 2 < Underside.Vertices.Num(); I += 3)
            Roofs.Triangle(Underside.Vertices[I + 2], Underside.Vertices[I + 1], Underside.Vertices[I], FLinearColor::White);
        const TArray<TSharedPtr<FJsonValue>>* Columns = nullptr;
        if ((*Structure)->TryGetArrayField(TEXT("columns"), Columns))
            for (const auto& Value : *Columns)
            {
                const auto Column = Value->AsObject();
                double X = 0, Z = 0, Radius = .22, ColumnHeight = Height - Thickness;
                Column->TryGetNumberField(TEXT("x"), X); Column->TryGetNumberField(TEXT("z"), Z);
                Column->TryGetNumberField(TEXT("radius"), Radius); Column->TryGetNumberField(TEXT("height"), ColumnHeight);
                TArray<FVector> Ring;
                for (int32 I = 0; I < 12; ++I)
                {
                    const double Angle = 2 * PI * I / 12;
                    Ring.Add(FVector((X + FMath::Cos(Angle) * Radius) * 100,
                        (-Z + FMath::Sin(Angle) * Radius) * 100, 0));
                }
                Extrude(Supports, Ring, ColumnHeight * 100, FLinearColor::White);
            }
        return true;
    }

    template<class T> T* Find(UWorld* World)
    {
        for (TActorIterator<T> It(World); It; ++It) return *It;
        return nullptr;
    }

    void Message(const FString& Text)
    {
        if (GEngine) GEngine->AddOnScreenDebugMessage(15, 6.0f, FColor::Cyan, Text);
    }

    UMaterialInterface* Material(const TCHAR* Name)
    {
        const FString Path = FString::Printf(TEXT("/Game/NeivaAssets/Materials/%s.%s"), Name, Name);
        auto* Result = LoadObject<UMaterialInterface>(nullptr, *Path);
        if (!Result) UE_LOG(LogTemp, Error, TEXT("Neiva: missing PBR material %s. Run bootstrap_editor.py."), *Path);
        return Result;
    }

    void Touch(APlayerController* PC)
    {
        if (!PC) return;
        UTouchInterface* Interface = LoadObject<UTouchInterface>(nullptr,
            TEXT("/Engine/MobileResources/HUD/DefaultVirtualJoysticks.DefaultVirtualJoysticks"));
        PC->ActivateTouchInterface(Interface);
        PC->bEnableTouchEvents = true;
        Message(TEXT("Controles tactiles activos. Boton INTERACTUAR a la derecha."));
    }

    bool GroundedCapsule(UWorld* World, FVector Candidate, float Radius, float HalfHeight,
        const FCollisionQueryParams& Query, FVector& Result)
    {
        FHitResult Ground;
        if (!World->LineTraceSingleByChannel(Ground, Candidate + FVector(0,0,300),
            Candidate - FVector(0,0,600), ECC_Visibility, Query) || Ground.ImpactNormal.Z < .65f) return false;
        Result = Ground.ImpactPoint + FVector(0,0,HalfHeight + 3);
        return !World->OverlapBlockingTestByChannel(Result, FQuat::Identity, ECC_Pawn,
            FCollisionShape::MakeCapsule(Radius, HalfHeight), Query);
    }
}

ANeivaCity::ANeivaCity()
{
    Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Geografia"));
    SetRootComponent(Mesh);
    Mesh->SetMobility(EComponentMobility::Static);
    Mesh->bUseAsyncCooking = false; // collision must exist before the player is placed
    Mesh->bUseComplexAsSimpleCollision = true;
}

void ANeivaCity::BuildCity()
{
    if (bBuilt) return;
    bBuilt = true;
    FString Raw;
    TSharedPtr<FJsonObject> Data;
    const FString Path = FPaths::ProjectContentDir() / TEXT("Data/neiva.json");
    if (!FFileHelper::LoadFileToString(Raw, *Path) ||
        !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), Data) || !Data.IsValid())
    {
        Status = TEXT("Falta Data/neiva.json. Ejecuta Scripts/prepare_project.py.");
        UE_LOG(LogTemp, Error, TEXT("%s"), *Status);
        return;
    }
    Raw.Empty(); // parsed JSON owns the values; release the duplicated source text now
    Surface = Neiva::Material(TEXT("M_Facade"));
    UpperSurface = Neiva::Material(TEXT("M_UpperFacade"));
    if (!UpperSurface) UpperSurface = Surface;
    RoadMaterial = Neiva::Material(TEXT("M_Road"));
    RoofMaterial = Neiva::Material(TEXT("M_Roof"));
    GrassMaterial = Neiva::Material(TEXT("M_Grass"));
    GroundMaterial = Neiva::Material(TEXT("M_Ground"));
    WaterMaterial = Neiva::Material(TEXT("M_Water"));
    const TArray<TSharedPtr<FJsonValue>>* Roads = nullptr;
    Data->TryGetArrayField(TEXT("roads"), Roads);
    double Nearest = TNumericLimits<double>::Max();
    FVector RoadSide(0, 1, 0);
    if (Roads)
    {
        for (const auto& Value : *Roads)
        {
            const auto P = Neiva::Points(Value->AsObject());
            for (int32 I = 1; I < P.Num(); ++I)
            {
                const FVector Mid = (P[I - 1] + P[I]) / 2;
                if (Mid.SizeSquared2D() >= Nearest) continue;
                Nearest = Mid.SizeSquared2D();
                SpawnPoint = Mid + FVector(0, 0, 150);
                const FVector Dir = (P[I] - P[I - 1]).GetSafeNormal();
                RoadSide = FVector(-Dir.Y, Dir.X, 0);
                CarPoint = Mid + Dir * 700 + FVector(0, 0, 70);
                StudioPoint = Mid + RoadSide * 1800;
            }
        }
    }
    const TSharedPtr<FJsonObject>* Meta = nullptr;
    if (Data->TryGetObjectField(TEXT("meta"), Meta))
    {
        if ((*Meta)->HasField(TEXT("spawn"))) SpawnPoint = Neiva::ReadPoint((*Meta)->TryGetField(TEXT("spawn")), 150);
        if ((*Meta)->HasField(TEXT("studio"))) StudioPoint = Neiva::ReadPoint((*Meta)->TryGetField(TEXT("studio")));
        if ((*Meta)->HasField(TEXT("car"))) CarPoint = Neiva::ReadPoint((*Meta)->TryGetField(TEXT("car")), 70);
        double Yaw = HALF_PI;
        if ((*Meta)->TryGetNumberField(TEXT("carYaw"), Yaw)) CarYaw = FMath::RadiansToDegrees(Yaw - HALF_PI);
    }
    if (Roads)
    {
        for (const auto& Value : *Roads)
        {
            const auto O = Value->AsObject();
            FString Type; O->TryGetStringField(TEXT("type"), Type);
            if (Type != TEXT("footway") && Type != TEXT("pedestrian") && Type != TEXT("path")) continue;
            const auto Route = Neiva::Points(O, 100);
            if (Route.Num() < 2 || FVector::Dist2D(Route[0], SpawnPoint) > 65000) continue;
            double Length = 0; for (int32 I = 1; I < Route.Num(); ++I) Length += FVector::Dist2D(Route[I-1], Route[I]);
            if (Length >= 600 && Length <= 50000) PedestrianRoutes.Add(Route);
        }
        PedestrianRoutes.Sort([this](const TArray<FVector>& A, const TArray<FVector>& B) {
            return FVector::DistSquared2D(A[0], SpawnPoint) < FVector::DistSquared2D(B[0], SpawnPoint);
        });
    }
    using namespace Neiva;
    const TSet<FString> LandmarkIds = bGenerateMapGeometry ? BuildLandmarks(Data) : TSet<FString>();
    FGeometry Terrain, Streets, Pavement, Water, Green, Studio;
    FParse::Value(FCommandLine::Get(), TEXT("NeivaBuildingRadius="), BuildingRadiusMeters);
    BuildingRadiusMeters = FMath::Max(0.f, BuildingRadiusMeters);
    BuildingTileSizeMeters = FMath::Clamp(BuildingTileSizeMeters, 100.f, 2000.f);
    double Extent = 1200000; // flat 24 km square, no claim of surveyed topography
    Terrain.Quad(FVector(-Extent, -Extent, -12), FVector(Extent, -Extent, -12),
        FVector(Extent, Extent, -12), FVector(-Extent, Extent, -12), FLinearColor(0.29f, 0.34f, 0.27f));
    int32 RoadCount = 0, BuildingCount = 0, TotalBuildings = 0, UncutCourtyards = 0;
    if (Roads && bGenerateMapGeometry)
    {
        for (const auto& Value : *Roads)
        {
            auto O = Value->AsObject();
            double Width = 7;
            O->TryGetNumberField(TEXT("width"), Width);
            const auto P = Points(O, 1);
            FString Finish; O->TryGetStringField(TEXT("material"), Finish);
            Ribbon(Finish == TEXT("pavement") ? Pavement : Streets, P,
                FMath::Clamp(Width, 2.0, 36.0) * 100, FLinearColor::White);
            ++RoadCount;
        }
    }
    const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
    if (bGenerateMapGeometry && Data->TryGetArrayField(TEXT("buildings"), Items))
    {
        TotalBuildings = Items->Num();
        // Group references first; construct only one sector's temporary buffers at a time.
        // This preserves independent render bounds without spawning a building actor per footprint.
        TMap<FIntPoint, TArray<TSharedPtr<FJsonObject>>> Sectors;
        for (const auto& Value : *Items)
        {
            const auto O = Value->AsObject();
            FString Id; O->TryGetStringField(TEXT("id"), Id);
            if (LandmarkIds.Contains(Id)) { ++BuildingCount; continue; }
            const auto P = Points(O);
            if (P.Num() < 3) continue;
            FVector Center = FVector::ZeroVector;
            for (const FVector& V : P) Center += V;
            Center /= P.Num();
            if (BuildingRadiusMeters > 0 && FVector::Dist2D(Center, SpawnPoint) > BuildingRadiusMeters * 100) continue;
            const double TileCm = BuildingTileSizeMeters * 100;
            const FIntPoint Key(FMath::FloorToInt(Center.X / TileCm), FMath::FloorToInt(Center.Y / TileCm));
            Sectors.FindOrAdd(Key).Add(O);
        }
        int32 Chunk = 0;
        auto Flush = [this, &Chunk](FGeometry& Geometry, FGeometry& Roofs, FGeometry& UpperWalls)
        {
            if (Geometry.Vertices.IsEmpty() && UpperWalls.Vertices.IsEmpty()) return;
            auto* Sector = NewObject<UProceduralMeshComponent>(this,
                *FString::Printf(TEXT("BuildingSector_%d"), Chunk++));
            Sector->SetupAttachment(Mesh);
            Sector->SetMobility(EComponentMobility::Static);
            Sector->bUseAsyncCooking = false;
            Sector->bUseComplexAsSimpleCollision = true;
            AddInstanceComponent(Sector);
            BuildingMeshes.Add(Sector);
            Sector->RegisterComponent();
            Geometry.Upload(Sector, 0, Surface, true);
            Roofs.Upload(Sector, 1, RoofMaterial, true);
            UpperWalls.Upload(Sector, 2, UpperSurface, true);
            Geometry = FGeometry();
            Roofs = FGeometry();
            UpperWalls = FGeometry();
        };
        for (const auto& Sector : Sectors)
        {
            FGeometry Geometry, Roofs, UpperWalls;
            for (const auto& O : Sector.Value)
            {
                double Height = 6;
                O->TryGetNumberField(TEXT("height"), Height);
                const float Shade = 0.65f + 0.16f * (BuildingCount % 5) / 4.0f;
                if (!Canopy(O, Geometry, Roofs, Height))
                    Extrude(Height > 6.4 ? UpperWalls : Geometry, Points(O), FMath::Clamp(Height, 2.0, 160.0) * 100,
                        FLinearColor(Shade, Shade * 0.91f, Shade * 0.79f), &Roofs);
                ++BuildingCount;
                const TArray<TSharedPtr<FJsonValue>>* Holes = nullptr;
                if (O->TryGetArrayField(TEXT("holes"), Holes) && !Holes->IsEmpty()) ++UncutCourtyards;
                if (Geometry.Vertices.Num() + Roofs.Vertices.Num() + UpperWalls.Vertices.Num() >= 60000)
                    Flush(Geometry, Roofs, UpperWalls);
            }
            Flush(Geometry, Roofs, UpperWalls);
        }
        UE_LOG(LogTemp, Display, TEXT("Neiva: %d/%d buildings in %d mesh chunks; preview radius %.0f m (0=all); %d exterior-only courtyard footprints."),
            BuildingCount, TotalBuildings, Chunk, BuildingRadiusMeters, UncutCourtyards);
    }
    for (const TCHAR* Key : {TEXT("water"), TEXT("parks")})
    {
        if (!bGenerateMapGeometry || !Data->TryGetArrayField(Key, Items)) continue;
        const bool IsWater = FString(Key) == TEXT("water");
        for (const auto& Value : *Items)
        {
            const auto O = Value->AsObject();
            bool Polygon = true;
            O->TryGetBoolField(TEXT("polygon"), Polygon);
            const auto P = Points(O, IsWater ? 4 : -3);
            const FLinearColor Color = IsWater ? FLinearColor(0.035f, 0.24f, 0.29f) : FLinearColor(0.14f, 0.29f, 0.15f);
            FGeometry& G = IsWater ? Water : Green;
            if (Polygon) Face(G, P, Color);
            else
            {
                double Width = 15;
                O->TryGetNumberField(TEXT("width"), Width);
                Ribbon(G, P, Width * 100, Color);
            }
        }
    }
    TArray<FVector> Footprint = {StudioPoint + FVector(-300, -200, 0), StudioPoint + FVector(300, -200, 0),
        StudioPoint + FVector(300, 200, 0), StudioPoint + FVector(-300, 200, 0)};
    Extrude(Studio, Footprint, 350, FLinearColor(0.12f, 0.54f, 0.51f));
    // Roof canopy and a visible fictional doorway, not a mapped real business.
    Studio.Quad(StudioPoint + FVector(-330, -300, 360), StudioPoint + FVector(330, -300, 360),
        StudioPoint + FVector(330, 250, 360), StudioPoint + FVector(-330, 250, 360), FLinearColor(0.06f, 0.11f, 0.13f));
    Studio.Quad(StudioPoint + FVector(-55, -201, 0), StudioPoint + FVector(55, -201, 0),
        StudioPoint + FVector(55, -201, 220), StudioPoint + FVector(-55, -201, 220), FLinearColor(0.02f, 0.08f, 0.1f));
    if (bGenerateMapGeometry)
    {
        Terrain.Upload(Mesh, 0, GroundMaterial, true);
        Streets.Upload(Mesh, 1, RoadMaterial, true);
        Pavement.Upload(Mesh, 2, Neiva::Material(TEXT("M_Pavement")), true);
        Water.Upload(Mesh, 3, WaterMaterial, false);
        Green.Upload(Mesh, 4, GrassMaterial, false);
    }
    Studio.Upload(Mesh, 5, Neiva::Material(TEXT("M_Studio")), true);
    UTextRenderComponent* Sign = NewObject<UTextRenderComponent>(this, TEXT("EstudioFicticio"));
    Sign->SetupAttachment(Mesh);
    Sign->SetRelativeLocation(StudioPoint + FVector(0, -240, 285));
    Sign->SetRelativeRotation(FRotator(0, -90, 0));
    Sign->SetHorizontalAlignment(EHorizTextAligment::EHTA_Center);
    Sign->SetWorldSize(34);
    Sign->SetText(FText::FromString(TEXT("JHON / DESARROLLO\nESTUDIO FICTICIO")));
    Sign->SetTextRenderColor(FColor::White);
    Sign->RegisterComponent();
    Status = FString::Printf(TEXT("Neiva / %d trazados / %d de %d huellas / alturas estimadas"), RoadCount, BuildingCount, TotalBuildings);
    if (BuildingRadiusMeters > 0) Status += FString::Printf(TEXT(" / radio %.0f m"), BuildingRadiusMeters);
}

ANeivaCharacter::ANeivaCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    GetCapsuleComponent()->InitCapsuleSize(36, 92);
    bUseControllerRotationYaw = false;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->RotationRate = FRotator(0, 540, 0);
    GetCharacterMovement()->MaxWalkSpeed = 200;
    GetCharacterMovement()->JumpZVelocity = 440;
    Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("BrazoCamara"));
    Arm->SetupAttachment(RootComponent);
    Arm->TargetArmLength = 440;
    Arm->SocketOffset = FVector(0, 55, 75);
    Arm->bUsePawnControlRotation = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camara"));
    Camera->SetupAttachment(Arm);
    GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ANeivaCharacter::BeginPlay()
{
    Super::BeginPlay();
    const auto* Settings = GetDefault<UNeivaVisualSettings>();
    USkeletalMesh* VisualMesh = Settings->CharacterMesh.LoadSynchronous();
    if (!VisualMesh)
    {
        UE_LOG(LogTemp, Error, TEXT("Neiva: import CharacterMesh with bootstrap_editor.py; no block avatar is substituted."));
        return;
    }
    GetMesh()->SetSkeletalMesh(VisualMesh);
    const FBoxSphereBounds Bounds = VisualMesh->GetBounds().TransformBy(FTransform(Settings->CharacterRotation));
    const float Scale = FMath::Max(1.f, Settings->CharacterHeightCm) / FMath::Max(1.f, float(Bounds.BoxExtent.Z * 2));
    GetMesh()->SetRelativeRotation(Settings->CharacterRotation);
    GetMesh()->SetRelativeScale3D(FVector(Scale));
    GetMesh()->SetRelativeLocation(-Bounds.Origin * Scale + FVector(0, 0,
        Bounds.BoxExtent.Z * Scale - GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight()));
    IdleAnimation = Settings->IdleAnimation.LoadSynchronous();
    WalkAnimation = Settings->WalkAnimation.LoadSynchronous();
    RunAnimation = Settings->RunAnimation.LoadSynchronous();
    // Reject clips from another skeleton; no implicit retargeting of a licensed rig.
    for (TObjectPtr<UAnimSequence>* Clip : {&IdleAnimation, &WalkAnimation, &RunAnimation})
    {
        if (*Clip && (*Clip)->GetSkeleton() != VisualMesh->GetSkeleton())
        {
            UE_LOG(LogTemp, Warning, TEXT("Neiva: incompatible animation skeleton for %s."), *(*Clip)->GetName());
            *Clip = nullptr;
        }
    }
    const TArray<FName> Slots = GetMesh()->GetMaterialSlotNames();
    for (int32 Index = 0; Index < Slots.Num(); ++Index)
        if (Slots[Index].ToString().Contains(TEXT("body"), ESearchCase::IgnoreCase))
        { Clothing = GetMesh()->CreateDynamicMaterialInstance(Index); break; }
    if (!bPedestrian)
    {
        if (const auto* Saved = Cast<UNeivaAppearanceSave>(UGameplayStatics::LoadGameFromSlot(TEXT("NeivaAppearance_v1"), 0)))
            SetAppearance(Saved->Shirt, Saved->Trousers);
    }
}

void ANeivaCharacter::Tick(float DT)
{
    Super::Tick(DT);
    const float Speed = GetVelocity().Size2D();
    UAnimSequence* Desired = Speed > 280 && RunAnimation ? RunAnimation.Get()
        : Speed > 8 && WalkAnimation ? WalkAnimation.Get() : IdleAnimation.Get();
    if (Desired && Desired != ActiveAnimation)
    {
        GetMesh()->PlayAnimation(Desired, true);
        ActiveAnimation = Desired;
    }
}

void ANeivaCharacter::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("Forward"), this, &ANeivaCharacter::Forward);
    Input->BindAxis(TEXT("Right"), this, &ANeivaCharacter::Right);
    Input->BindAxis(TEXT("LookYaw"), this, &ANeivaCharacter::LookYaw);
    Input->BindAxis(TEXT("LookPitch"), this, &ANeivaCharacter::LookPitch);
    Input->BindAction(TEXT("Jump"), IE_Pressed, this, &ACharacter::Jump);
    Input->BindAction(TEXT("Jump"), IE_Released, this, &ACharacter::StopJumping);
    Input->BindAction(TEXT("Sprint"), IE_Pressed, this, &ANeivaCharacter::SprintOn);
    Input->BindAction(TEXT("Sprint"), IE_Released, this, &ANeivaCharacter::SprintOff);
    Input->BindAction(TEXT("Interact"), IE_Pressed, this, &ANeivaCharacter::Interact);
    Input->BindAction(TEXT("Reset"), IE_Pressed, this, &ANeivaCharacter::ResetPosition);
    Input->BindAction(TEXT("TouchControls"), IE_Pressed, this, &ANeivaCharacter::ToggleTouchControls);
    Input->BindAction(TEXT("Shirt"), IE_Pressed, this, &ANeivaCharacter::CycleShirt);
    Input->BindAction(TEXT("Trousers"), IE_Pressed, this, &ANeivaCharacter::CycleTrousers);
}
void ANeivaCharacter::Forward(float V) { if (Controller) AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::X), V); }
void ANeivaCharacter::Right(float V) { if (Controller) AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::Y), V); }
void ANeivaCharacter::LookYaw(float V) { AddControllerYawInput(V); }
void ANeivaCharacter::LookPitch(float V) { AddControllerPitchInput(V); }
void ANeivaCharacter::SprintOn() { GetCharacterMovement()->MaxWalkSpeed = 540; }
void ANeivaCharacter::SprintOff() { GetCharacterMovement()->MaxWalkSpeed = 200; }
void ANeivaCharacter::SetAppearance(int32 Shirt, int32 Trousers, bool bPersist)
{
    static const FLinearColor Shirts[] = {FLinearColor::White, FLinearColor(.16,.37,.65), FLinearColor(.21,.42,.26), FLinearColor(.5,.16,.13)};
    static const FLinearColor Bottoms[] = {FLinearColor::White, FLinearColor(.22,.29,.41), FLinearColor(.26,.27,.24), FLinearColor(.44,.27,.16)};
    ShirtStyle = FMath::Clamp(Shirt, 0, 3); TrouserStyle = FMath::Clamp(Trousers, 0, 3);
    if (Clothing)
    {
        Clothing->SetVectorParameterValue(TEXT("ShirtTint"), Shirts[ShirtStyle]);
        Clothing->SetVectorParameterValue(TEXT("ShortsTint"), Bottoms[TrouserStyle]);
    }
    if (bPersist && !bPedestrian)
    {
        auto* Saved = Cast<UNeivaAppearanceSave>(UGameplayStatics::CreateSaveGameObject(UNeivaAppearanceSave::StaticClass()));
        if (!Saved) { Neiva::Message(TEXT("No se pudo crear el guardado de ropa.")); return; }
        Saved->Shirt = ShirtStyle; Saved->Trousers = TrouserStyle;
        if (!UGameplayStatics::SaveGameToSlot(Saved, TEXT("NeivaAppearance_v1"), 0))
            Neiva::Message(TEXT("No se pudo guardar la ropa. La seleccion actual sigue activa."));
    }
}
void ANeivaCharacter::CycleShirt() { SetAppearance((ShirtStyle + 1) % 4, TrouserStyle, true); }
void ANeivaCharacter::CycleTrousers() { SetAppearance(ShirtStyle, (TrouserStyle + 1) % 4, true); }
FString ANeivaCharacter::AppearanceLabel() const
{ return FString::Printf(TEXT("C camiseta %d/4 | V pantalon %d/4 | colores de tela; misma prenda"), ShirtStyle + 1, TrouserStyle + 1); }
void ANeivaCharacter::ToggleTouchControls() { Neiva::Touch(Cast<APlayerController>(Controller)); }
void ANeivaCharacter::ResetPosition()
{
    if (ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld()))
    {
        GetCharacterMovement()->StopMovementImmediately();
        SetActorLocation(City->SpawnPoint, false, nullptr, ETeleportType::TeleportPhysics);
    }
}
void ANeivaCharacter::Interact()
{
    for (TActorIterator<ANeivaCar> It(GetWorld()); It; ++It)
    {
        if (FVector::Dist2D(GetActorLocation(), It->GetActorLocation()) < 450)
        { It->Enter(this); return; }
    }
    if (ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld()))
    {
        if (FVector::Dist2D(GetActorLocation(), City->StudioPoint) < 1000)
        {
            FPlatformProcess::LaunchURL(Neiva::ContactURL, nullptr, nullptr);
            Neiva::Message(TEXT("Jhon: alvarezruizj289@gmail.com / desarrollo web, datos y software."));
            return;
        }
    }
    for (TActorIterator<ANeivaPedestrian> It(GetWorld()); It; ++It)
        if (FVector::Dist2D(GetActorLocation(), It->GetActorLocation()) < 240)
        { Neiva::Message(TEXT("Buen dia. El Parque Santander esta en el centro; E junto al estudio abre el contacto de Jhon.")); return; }
    Neiva::Message(TEXT("Acercate al carro o al pequeno estudio turquesa de Jhon."));
}

ANeivaPedestrian::ANeivaPedestrian()
{
    bPedestrian = true;
    AutoPossessAI = EAutoPossessAI::Disabled;
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
    GetCharacterMovement()->MaxWalkSpeed = 125;
    // Input is consumed every CharacterMovement frame, so submit it every frame.
    PrimaryActorTick.TickInterval = 0;
}
void ANeivaPedestrian::SetRoute(const TArray<FVector>& Points, int32 AppearanceSeed)
{
    Route = Points; TargetPoint = 1; Direction = 1;
    PreviousLocation = GetActorLocation();
    SetAppearance(AppearanceSeed % 4, (AppearanceSeed / 2) % 4);
}
void ANeivaPedestrian::Tick(float DT)
{
    Super::Tick(DT);
    if (Route.Num() < 2) return;
    if (WaitSeconds > 0) { WaitSeconds -= DT; return; }
    FVector Offset = Route[TargetPoint] - GetActorLocation(); Offset.Z = 0;
    if (Offset.Size() < 75)
    {
        if (TargetPoint + Direction >= Route.Num() || TargetPoint + Direction < 0)
        { Direction *= -1; WaitSeconds = 1.5f; }
        TargetPoint += Direction; StuckSeconds = 0; return;
    }
    const FVector Desired = Offset.GetSafeNormal();
    FCollisionQueryParams Query; Query.AddIgnoredActor(this);
    FHitResult Hit;
    const bool Blocked = GetWorld()->SweepSingleByChannel(Hit, GetActorLocation(),
        GetActorLocation() + Desired * 110, FQuat::Identity, ECC_Pawn,
        FCollisionShape::MakeCapsule(42, 86), Query) && Hit.ImpactNormal.Z < .5f;
    if (!Blocked) AddMovementInput(Desired, 1, true);
    if (Blocked || FVector::DistSquared2D(GetActorLocation(), PreviousLocation) < 1) StuckSeconds += DT;
    else StuckSeconds = 0;
    PreviousLocation = GetActorLocation();
    if (StuckSeconds > 2)
    {
        // Reverse along the existing path; never teleport through an obstacle.
        Direction *= -1; TargetPoint = FMath::Clamp(TargetPoint + Direction, 0, Route.Num() - 1);
        WaitSeconds = .8f; StuckSeconds = 0;
    }
}

ANeivaCar::ANeivaCar()
{
    PrimaryActorTick.bCanEverTick = true;
    Collision = CreateDefaultSubobject<UBoxComponent>(TEXT("Colision"));
    Collision->SetBoxExtent(FVector(205, 95, 60));
    Collision->SetCollisionProfileName(TEXT("Pawn"));
    SetRootComponent(Collision);
    Visual = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("CarroceriaImportada"));
    Visual->SetupAttachment(RootComponent);
    Visual->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("BrazoCamara"));
    Arm->SetupAttachment(RootComponent);
    Arm->TargetArmLength = 750;
    Arm->SetRelativeRotation(FRotator(-18,0,0));
    Arm->SocketOffset = FVector(0,0,240);
    Arm->bEnableCameraLag = true;
    Arm->bUsePawnControlRotation = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camara"));
    Camera->SetupAttachment(Arm);
}
void ANeivaCar::BeginPlay()
{
    Super::BeginPlay();
    const auto* Settings = GetDefault<UNeivaVisualSettings>();
    UStaticMesh* CarMesh = Settings->CarMesh.LoadSynchronous();
    if (!CarMesh)
    {
        UE_LOG(LogTemp, Error, TEXT("Neiva: import CarMesh with bootstrap_editor.py; no block car is substituted."));
        return;
    }
    Visual->SetStaticMesh(CarMesh);
    const FBoxSphereBounds Bounds = CarMesh->GetBounds().TransformBy(FTransform(Settings->CarRotation));
    const float Length = float(FMath::Max(Bounds.BoxExtent.X, Bounds.BoxExtent.Y) * 2);
    const float Scale = FMath::Max(1.f, Settings->CarLengthCm) / FMath::Max(1.f, Length);
    Visual->SetRelativeRotation(Settings->CarRotation);
    Visual->SetRelativeScale3D(FVector(Scale));
    Visual->SetRelativeLocation(-Bounds.Origin * Scale + FVector(0, 0,
        Bounds.BoxExtent.Z * Scale - Collision->GetUnscaledBoxExtent().Z));
    MotionState.Yaw = FMath::DegreesToRadians(GetActorRotation().Yaw);
}
void ANeivaCar::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("Forward"), this, &ANeivaCar::Throttle);
    Input->BindAxis(TEXT("Right"), this, &ANeivaCar::Steer);
    Input->BindAxis(TEXT("LookYaw"), this, &ANeivaCar::LookYaw);
    Input->BindAxis(TEXT("LookPitch"), this, &ANeivaCar::LookPitch);
    Input->BindAction(TEXT("Jump"), IE_Pressed, this, &ANeivaCar::BrakeOn);
    Input->BindAction(TEXT("Jump"), IE_Released, this, &ANeivaCar::BrakeOff);
    Input->BindAction(TEXT("Interact"), IE_Pressed, this, &ANeivaCar::Exit);
    Input->BindAction(TEXT("Reset"), IE_Pressed, this, &ANeivaCar::ResetPosition);
    Input->BindAction(TEXT("TouchControls"), IE_Pressed, this, &ANeivaCar::ToggleTouchControls);
    Input->BindAction(TEXT("Shirt"), IE_Pressed, this, &ANeivaCar::CycleShirt);
    Input->BindAction(TEXT("Trousers"), IE_Pressed, this, &ANeivaCar::CycleTrousers);
}
void ANeivaCar::Throttle(float V) { ThrottleInput = V; }
void ANeivaCar::Steer(float V) { SteeringInput = V; }
void ANeivaCar::BrakeOn() { bBrake = true; }
void ANeivaCar::BrakeOff() { bBrake = false; }
void ANeivaCar::LookYaw(float V) { AddControllerYawInput(V); }
void ANeivaCar::LookPitch(float V) { AddControllerPitchInput(V); }
void ANeivaCar::CycleShirt() { if (Passenger) Passenger->CycleShirt(); }
void ANeivaCar::CycleTrousers() { if (Passenger) Passenger->CycleTrousers(); }
void ANeivaCar::ToggleTouchControls() { Neiva::Touch(Cast<APlayerController>(Controller)); }
void ANeivaCar::ResetPosition()
{
    if (ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld()))
        SetActorLocationAndRotation(City->CarPoint, FRotator(0, City->CarYaw, 0), false, nullptr, ETeleportType::TeleportPhysics);
    Speed = ThrottleInput = SteeringInput = 0; bBrake = false;
    MotionState = {}; MotionState.Yaw = FMath::DegreesToRadians(GetActorRotation().Yaw); MotionClock.Reset();
}
void ANeivaCar::Tick(float DT)
{
    Super::Tick(DT);
    MotionClock.Advance(DT, [this](double StepSeconds)
    {
        const double PreviousYaw = MotionState.Yaw;
        const auto Delta = NeivaMotion::Step(MotionState,
            {Passenger ? ThrottleInput : 0, Passenger ? SteeringInput : 0, bBrake}, StepSeconds);
        const FRotator Rotation(0, FMath::RadiansToDegrees(MotionState.Yaw), 0);
        FCollisionQueryParams Query; Query.AddIgnoredActor(this);
        if (Passenger) Query.AddIgnoredActor(Passenger);
        if (GetWorld()->OverlapBlockingTestByChannel(GetActorLocation(), Rotation.Quaternion(), ECC_Pawn,
            FCollisionShape::MakeBox(Collision->GetScaledBoxExtent()), Query))
        { MotionState.Yaw = PreviousYaw; MotionState.Speed = 0; return; }
        SetActorRotation(Rotation);
        FHitResult Hit;
        AddActorWorldOffset(FVector(Delta.X * 100, Delta.Y * 100, 0), true, &Hit);
        if (Hit.IsValidBlockingHit()) MotionState.Speed = 0;
    });
    Speed = MotionState.Speed * 100;
}
void ANeivaCar::Enter(ANeivaCharacter* Character)
{
    if (!Character || Passenger || FVector::Dist2D(Character->GetActorLocation(), GetActorLocation()) > 450) return;
    APlayerController* PC = Cast<APlayerController>(Character->GetController());
    if (!PC) return;
    Passenger = Character;
    Passenger->GetCharacterMovement()->StopMovementImmediately();
    Passenger->GetCharacterMovement()->DisableMovement();
    Passenger->SetActorEnableCollision(false);
    Passenger->SetActorHiddenInGame(true);
    Passenger->SetActorTickEnabled(false);
    Passenger->AttachToActor(this, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
    PC->Possess(this);
    PC->SetControlRotation(FRotator(-15, GetActorRotation().Yaw, 0));
    Speed = ThrottleInput = SteeringInput = 0; bBrake = false;
    MotionState = {}; MotionState.Yaw = FMath::DegreesToRadians(GetActorRotation().Yaw); MotionClock.Reset();
}
void ANeivaCar::Exit()
{
    APlayerController* PC = Cast<APlayerController>(Controller);
    if (!Passenger || !PC) return;
    FCollisionQueryParams Query;
    Query.AddIgnoredActor(this);
    Query.AddIgnoredActor(Passenger);
    FVector ExitPoint;
    bool Found = false;
    for (const float Side : {-1.0f, 1.0f})
    {
        for (const float Distance : {230.f, 340.f, 480.f})
            if (Neiva::GroundedCapsule(GetWorld(), GetActorLocation() + GetActorRightVector() * Distance * Side,
                Passenger->GetCapsuleComponent()->GetScaledCapsuleRadius(),
                Passenger->GetCapsuleComponent()->GetScaledCapsuleHalfHeight(), Query, ExitPoint))
            { Found = true; break; }
        if (Found) break;
    }
    if (!Found) { Neiva::Message(TEXT("Salida bloqueada. Mueve el carro a un lugar abierto.")); return; }
    Speed = ThrottleInput = SteeringInput = 0;
    MotionState.Speed = 0; MotionClock.Reset(); bBrake = false;
    Passenger->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
    Passenger->SetActorLocation(ExitPoint, false, nullptr, ETeleportType::TeleportPhysics);
    Passenger->SetActorHiddenInGame(false);
    Passenger->SetActorEnableCollision(true);
    Passenger->SetActorTickEnabled(true);
    Passenger->GetCharacterMovement()->SetMovementMode(MOVE_Walking);
    Passenger->GetCharacterMovement()->MaxWalkSpeed = 200;
    PC->Possess(Passenger);
    Passenger = nullptr;
}

ANeivaGameMode::ANeivaGameMode()
{
    DefaultPawnClass = ANeivaCharacter::StaticClass();
    HUDClass = ANeivaHUD::StaticClass();
}
void ANeivaGameMode::StartPlay()
{
    ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld());
    if (!City) City = GetWorld()->SpawnActor<ANeivaCity>();
    City->BuildCity();
    if (!Neiva::Find<ANeivaCar>(GetWorld()))
    {
        FActorSpawnParameters Params;
        Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        GetWorld()->SpawnActor<ANeivaCar>(City->CarPoint, FRotator(0, City->CarYaw, 0), Params);
    }
    if (!Neiva::Find<ADirectionalLight>(GetWorld()))
    {
        ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>(FVector(0,0,20000), FRotator(-52,-35,0));
        Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
        Sun->GetLightComponent()->SetIntensity(75000.f);
        Sun->GetLightComponent()->SetLightColor(FLinearColor(1,.87,.73));
        if (auto* Directional = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
            Directional->SetAtmosphereSunLight(true);
    }
    if (!Neiva::Find<ASkyAtmosphere>(GetWorld())) GetWorld()->SpawnActor<ASkyAtmosphere>();
    if (!Neiva::Find<ASkyLight>(GetWorld()))
    {
        ASkyLight* Sky = GetWorld()->SpawnActor<ASkyLight>();
        Sky->GetLightComponent()->SetMobility(EComponentMobility::Movable);
        Sky->GetLightComponent()->SetIntensity(1.2f);
        Sky->GetLightComponent()->SetLowerHemisphereColor(FLinearColor(.20,.27,.36));
        if (UTextureCube* Environment = GetDefault<UNeivaVisualSettings>()->EnvironmentCube.LoadSynchronous())
        {
            Sky->GetLightComponent()->SourceType = SLS_SpecifiedCubemap;
            Sky->GetLightComponent()->SetCubemap(Environment);
        }
        else Sky->GetLightComponent()->RecaptureSky();
    }
    Super::StartPlay();
    if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
    {
        PC->bEnableTouchEvents = true;
        if (ANeivaCharacter* Character = Cast<ANeivaCharacter>(PC->GetPawn())) Character->ResetPosition();
        PC->SetControlRotation(FRotator(-12, 20, 0));
    }
    if (!Neiva::Find<ANeivaPedestrian>(GetWorld()))
    {
        const int32 Requested = FMath::Clamp(GetDefault<UNeivaVisualSettings>()->PedestrianCount, 0, 24);
        for (const auto& Route : City->PedestrianRoutes)
        {
            if (City->ActivePedestrians >= Requested) break;
            FVector Position;
            FCollisionQueryParams Query;
            if (!Neiva::GroundedCapsule(GetWorld(), Route[0], 36, 92, Query, Position)) continue;
            FActorSpawnParameters Params;
            Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::DontSpawnIfColliding;
            if (auto* Person = GetWorld()->SpawnActor<ANeivaPedestrian>(Position, FRotator::ZeroRotator, Params))
                Person->SetRoute(Route, City->ActivePedestrians++);
        }
        City->Status += FString::Printf(TEXT(" / %d peatones en caminos OSM"), City->ActivePedestrians);
        UE_LOG(LogTemp, Display, TEXT("Neiva: spawned %d/%d pedestrians on %d candidate paths; blocked spawn points skipped."),
            City->ActivePedestrians, Requested, City->PedestrianRoutes.Num());
    }
}

void ANeivaHUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas) return;
    const float S = FMath::Clamp(Canvas->ClipX / 1300.f, .75f, 1.4f);
    DrawRect(FLinearColor(.018,.028,.035,.87), 18, 18, FMath::Min(Canvas->ClipX - 36, 720.f*S), 108*S);
    DrawText(TEXT("NEIVA ABIERTA"), FColor::White, 34, 29, nullptr, 1.65f*S);
    if (ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld()))
    {
        DrawText(City->Status, FColor(168,203,195), 34, 62*S, nullptr, .9f*S);
        if (PlayerOwner && PlayerOwner->GetPawn())
        {
            const float Distance = FVector::Dist2D(PlayerOwner->GetPawn()->GetActorLocation(), City->StudioPoint) / 100;
            DrawText(FString::Printf(TEXT("Estudio ficticio de Jhon: %.0f m | contacto por correo al pulsar E"), Distance),
                FColor::White, 34, 84*S, nullptr, .85f*S);
        }
    }
    const bool Driving = PlayerOwner && Cast<ANeivaCar>(PlayerOwner->GetPawn());
    ANeivaCharacter* Avatar = PlayerOwner ? Cast<ANeivaCharacter>(PlayerOwner->GetPawn()) : nullptr;
    if (Driving) Avatar = Cast<ANeivaCar>(PlayerOwner->GetPawn())->GetPassenger();
    if (Avatar) DrawText(Avatar->AppearanceLabel(), FColor(182,211,191), 24, Canvas->ClipY - 96, nullptr, .73f*S);
    DrawText(Driving ? TEXT("WASD conducir | Espacio frenar | E salir | R reiniciar | T controles tactiles") :
        TEXT("WASD caminar | mouse mirar | Shift correr | Espacio saltar | E interactuar | R volver | T tactil"),
        FColor::White, 24, Canvas->ClipY - 65, nullptr, .87f*S);
    DrawText(TEXT("Datos: OpenStreetMap y Overture Maps / ODbL. Cobertura parcial; huellas y alturas estimadas."),
        FColor(182,191,191), 24, Canvas->ClipY - 35, nullptr, .73f*S);
    const FVector2D Button(Canvas->ClipX - 178*S, Canvas->ClipY - 170*S);
    DrawRect(FLinearColor(.05,.43,.39,.94), Button.X, Button.Y, 152*S, 58*S);
    DrawText(Driving ? TEXT("SALIR") : TEXT("INTERACTUAR"), FColor::White, Button.X + 12*S, Button.Y + 20*S, nullptr, S);
    AddHitBox(Button, FVector2D(152*S,58*S), TEXT("Interact"), true);
    for (int32 Row = 0; Row < 2; ++Row)
    {
        const FVector2D Position(Button.X, Button.Y - (2 - Row) * 54*S);
        DrawRect(FLinearColor(.04,.16,.14,.94), Position.X, Position.Y, 152*S, 46*S);
        DrawText(Row ? TEXT("PANTALON / V") : TEXT("CAMISETA / C"), FColor::White,
            Position.X + 10*S, Position.Y + 15*S, nullptr, .8f*S);
        AddHitBox(Position, FVector2D(152*S,46*S), Row ? TEXT("Trousers") : TEXT("Shirt"), true);
    }
}
void ANeivaHUD::NotifyHitBoxClick(FName BoxName)
{
    Super::NotifyHitBoxClick(BoxName);
    if (!PlayerOwner) return;
    ANeivaCar* Car = Cast<ANeivaCar>(PlayerOwner->GetPawn());
    ANeivaCharacter* Character = Car ? Car->GetPassenger() : Cast<ANeivaCharacter>(PlayerOwner->GetPawn());
    if (BoxName == TEXT("Shirt") && Character) Character->CycleShirt();
    else if (BoxName == TEXT("Trousers") && Character) Character->CycleTrousers();
    else if (BoxName == TEXT("Interact"))
    { if (Car) Car->Exit(); else if (Character) Character->Interact(); }
}
