#include "NeivaWorld.h"

#include "Algo/Reverse.h"
#include "Camera/CameraComponent.h"
#include "CollisionQueryParams.h"
#include "CollisionShape.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/InputComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/Canvas.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/SkyLight.h"
#include "Engine/SkyAtmosphere.h"
#include "Engine/StaticMesh.h"
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
                UVs.Add(FVector2D(P.X, P.Y + P.Z) / 250.0);
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
            Mesh->CreateMeshSection_LinearColor(Index, Vertices, Indices, Normals, UVs,
                Colors, TArray<FProcMeshTangent>(), Collision);
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

    void Extrude(FGeometry& G, TArray<FVector> P, double Height, FLinearColor Color)
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
        Face(G, P, Color * FLinearColor(0.7f, 0.72f, 0.76f, 1));
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

    template<class T> T* Find(UWorld* World)
    {
        for (TActorIterator<T> It(World); It; ++It) return *It;
        return nullptr;
    }

    void Message(const FString& Text)
    {
        if (GEngine) GEngine->AddOnScreenDebugMessage(15, 6.0f, FColor::Cyan, Text);
    }

    void ColorMesh(UStaticMeshComponent* Mesh, FLinearColor Color)
    {
        // Constructors only record the color: dynamic UObjects are created in BeginPlay.
        Mesh->ComponentTags.Add(FName(*(TEXT("NeivaColor:") + Color.ToString())));
    }

    void ApplyColors(AActor* Actor)
    {
        UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_NeivaSolid.M_NeivaSolid"));
        if (!Base) return;
        TInlineComponentArray<UStaticMeshComponent*> Components(Actor);
        for (UStaticMeshComponent* Mesh : Components)
        {
            for (FName Tag : Mesh->ComponentTags)
            {
                const FString Text = Tag.ToString();
                if (!Text.StartsWith(TEXT("NeivaColor:"))) continue;
                FLinearColor Color;
                if (!Color.InitFromString(Text.RightChop(11))) continue;
                UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base, Mesh);
                M->SetVectorParameterValue(TEXT("Color"), Color);
                Mesh->SetMaterial(0, M);
                break;
            }
        }
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
    Surface = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_NeivaSurface.M_NeivaSurface"));
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
    using namespace Neiva;
    FGeometry Terrain, Streets, Water, Green, Studio;
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
            Ribbon(Streets, P, FMath::Clamp(Width, 2.0, 36.0) * 100, FLinearColor(0.085f, 0.10f, 0.12f));
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
        auto Flush = [this, &Chunk](FGeometry& Geometry)
        {
            if (Geometry.Vertices.IsEmpty()) return;
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
            Geometry = FGeometry();
        };
        for (const auto& Sector : Sectors)
        {
            FGeometry Geometry;
            for (const auto& O : Sector.Value)
            {
                double Height = 6;
                O->TryGetNumberField(TEXT("height"), Height);
                const float Shade = 0.65f + 0.16f * (BuildingCount % 5) / 4.0f;
                Extrude(Geometry, Points(O), FMath::Clamp(Height, 2.0, 160.0) * 100,
                    FLinearColor(Shade, Shade * 0.91f, Shade * 0.79f));
                ++BuildingCount;
                const TArray<TSharedPtr<FJsonValue>>* Holes = nullptr;
                if (O->TryGetArrayField(TEXT("holes"), Holes) && !Holes->IsEmpty()) ++UncutCourtyards;
                if (Geometry.Vertices.Num() >= 60000) Flush(Geometry);
            }
            Flush(Geometry);
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
        Terrain.Upload(Mesh, 0, Surface, true);
        Streets.Upload(Mesh, 1, Surface, true);
        Water.Upload(Mesh, 3, Surface, false);
        Green.Upload(Mesh, 4, Surface, false);
    }
    Studio.Upload(Mesh, 5, Surface, true);
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
    GetCapsuleComponent()->InitCapsuleSize(36, 92);
    bUseControllerRotationYaw = false;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->RotationRate = FRotator(0, 540, 0);
    GetCharacterMovement()->MaxWalkSpeed = 420;
    GetCharacterMovement()->JumpZVelocity = 440;
    Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("BrazoCamara"));
    Arm->SetupAttachment(RootComponent);
    Arm->TargetArmLength = 440;
    Arm->SocketOffset = FVector(0, 55, 75);
    Arm->bUsePawnControlRotation = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camara"));
    Camera->SetupAttachment(Arm);
    struct FPart { const TCHAR* Name; FVector Position; FVector Scale; FLinearColor Color; bool Sphere; };
    const FPart Parts[] = {
        {TEXT("Torso"), FVector(0,0,2), FVector(.42,.30,.65), FLinearColor(.07,.27,.25), false},
        {TEXT("Cabeza"), FVector(0,0,54), FVector(.29,.29,.33), FLinearColor(.49,.30,.19), true},
        {TEXT("PiernaIzq"), FVector(0,-12,-56), FVector(.17,.17,.60), FLinearColor(.035,.05,.07), false},
        {TEXT("PiernaDer"), FVector(0,12,-56), FVector(.17,.17,.60), FLinearColor(.035,.05,.07), false},
        {TEXT("BrazoIzq"), FVector(0,-26,2), FVector(.14,.14,.62), FLinearColor(.49,.30,.19), false},
        {TEXT("BrazoDer"), FVector(0,26,2), FVector(.14,.14,.62), FLinearColor(.49,.30,.19), false}
    };
    for (const FPart& Part : Parts)
    {
        auto* Body = CreateDefaultSubobject<UStaticMeshComponent>(Part.Name);
        Body->SetupAttachment(RootComponent);
        Body->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, Part.Sphere ? TEXT("/Engine/BasicShapes/Sphere.Sphere") : TEXT("/Engine/BasicShapes/Cube.Cube")));
        Body->SetRelativeLocation(Part.Position);
        Body->SetRelativeScale3D(Part.Scale);
        Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Neiva::ColorMesh(Body, Part.Color);
    }
}

void ANeivaCharacter::BeginPlay()
{
    Super::BeginPlay();
    Neiva::ApplyColors(this);
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
}
void ANeivaCharacter::Forward(float V) { if (Controller) AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::X), V); }
void ANeivaCharacter::Right(float V) { if (Controller) AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::Y), V); }
void ANeivaCharacter::LookYaw(float V) { AddControllerYawInput(V); }
void ANeivaCharacter::LookPitch(float V) { AddControllerPitchInput(V); }
void ANeivaCharacter::SprintOn() { GetCharacterMovement()->MaxWalkSpeed = 700; }
void ANeivaCharacter::SprintOff() { GetCharacterMovement()->MaxWalkSpeed = 420; }
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
    Neiva::Message(TEXT("Acercate al carro o al pequeno estudio turquesa de Jhon."));
}

ANeivaCar::ANeivaCar()
{
    PrimaryActorTick.bCanEverTick = true;
    Collision = CreateDefaultSubobject<UBoxComponent>(TEXT("Colision"));
    Collision->SetBoxExtent(FVector(205, 95, 60));
    Collision->SetCollisionProfileName(TEXT("Pawn"));
    SetRootComponent(Collision);
    auto* Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Carroceria"));
    Body->SetupAttachment(RootComponent);
    Body->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));
    Body->SetRelativeScale3D(FVector(4.1, 1.8, .65));
    Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Neiva::ColorMesh(Body, FLinearColor(.045,.34,.35));
    auto* Cabin = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Cabina"));
    Cabin->SetupAttachment(RootComponent);
    Cabin->SetStaticMesh(Body->GetStaticMesh());
    Cabin->SetRelativeLocation(FVector(-20,0,52));
    Cabin->SetRelativeScale3D(FVector(2.1,1.6,.65));
    Cabin->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Neiva::ColorMesh(Cabin, FLinearColor(.018,.045,.075));
    for (int32 I = 0; I < 4; ++I)
    {
        auto* Wheel = CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("Rueda%d"), I));
        Wheel->SetupAttachment(RootComponent);
        Wheel->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder")));
        Wheel->SetRelativeLocation(FVector(I < 2 ? 130 : -130, I % 2 ? 91 : -91, -34));
        Wheel->SetRelativeRotation(FRotator(0,0,90));
        Wheel->SetRelativeScale3D(FVector(.64,.64,.24));
        Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Neiva::ColorMesh(Wheel, FLinearColor(.025,.03,.035));
    }
    Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("BrazoCamara"));
    Arm->SetupAttachment(RootComponent);
    Arm->TargetArmLength = 750;
    Arm->SetRelativeRotation(FRotator(-18,0,0));
    Arm->SocketOffset = FVector(0,0,240);
    Arm->bEnableCameraLag = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camara"));
    Camera->SetupAttachment(Arm);
}
void ANeivaCar::BeginPlay()
{
    Super::BeginPlay();
    Neiva::ApplyColors(this);
}
void ANeivaCar::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("Forward"), this, &ANeivaCar::Throttle);
    Input->BindAxis(TEXT("Right"), this, &ANeivaCar::Steer);
    Input->BindAction(TEXT("Jump"), IE_Pressed, this, &ANeivaCar::BrakeOn);
    Input->BindAction(TEXT("Jump"), IE_Released, this, &ANeivaCar::BrakeOff);
    Input->BindAction(TEXT("Interact"), IE_Pressed, this, &ANeivaCar::Exit);
    Input->BindAction(TEXT("Reset"), IE_Pressed, this, &ANeivaCar::ResetPosition);
    Input->BindAction(TEXT("TouchControls"), IE_Pressed, this, &ANeivaCar::ToggleTouchControls);
}
void ANeivaCar::Throttle(float V) { ThrottleInput = V; }
void ANeivaCar::Steer(float V) { SteeringInput = V; }
void ANeivaCar::BrakeOn() { bBrake = true; }
void ANeivaCar::BrakeOff() { bBrake = false; }
void ANeivaCar::ToggleTouchControls() { Neiva::Touch(Cast<APlayerController>(Controller)); }
void ANeivaCar::ResetPosition()
{
    if (ANeivaCity* City = Neiva::Find<ANeivaCity>(GetWorld())) SetActorLocation(City->CarPoint);
    Speed = 0;
}
void ANeivaCar::Tick(float DT)
{
    Super::Tick(DT);
    DT = FMath::Min(DT, .05f);
    const float Target = Passenger ? ThrottleInput * (ThrottleInput < 0 ? 650 : 1850) : 0;
    Speed = FMath::FInterpTo(Speed, bBrake ? 0 : Target, DT, bBrake ? 5.5f : 1.0f);
    if (FMath::Abs(Speed) < 1) return;
    AddActorWorldRotation(FRotator(0, SteeringInput * 58 * DT * FMath::Clamp(Speed / 750, -1.0f, 1.0f), 0));
    FHitResult Hit;
    AddActorWorldOffset(GetActorForwardVector() * Speed * DT, true, &Hit);
    if (Hit.IsValidBlockingHit()) Speed = 0;
}
void ANeivaCar::Enter(ANeivaCharacter* Character)
{
    if (!Character || Passenger) return;
    APlayerController* PC = Cast<APlayerController>(Character->GetController());
    if (!PC) return;
    Passenger = Character;
    Passenger->GetCharacterMovement()->StopMovementImmediately();
    Passenger->SetActorEnableCollision(false);
    Passenger->SetActorHiddenInGame(true);
    Passenger->AttachToActor(this, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
    PC->Possess(this);
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
        ExitPoint = GetActorLocation() + GetActorRightVector() * 230 * Side + FVector(0,0,70);
        if (!GetWorld()->OverlapBlockingTestByChannel(ExitPoint, FQuat::Identity, ECC_Pawn,
            FCollisionShape::MakeCapsule(36, 92), Query)) { Found = true; break; }
    }
    if (!Found) { Neiva::Message(TEXT("Salida bloqueada. Mueve el carro a un lugar abierto.")); return; }
    Speed = ThrottleInput = SteeringInput = 0;
    Passenger->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
    Passenger->SetActorLocation(ExitPoint, false, nullptr, ETeleportType::TeleportPhysics);
    Passenger->SetActorHiddenInGame(false);
    Passenger->SetActorEnableCollision(true);
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
        if (auto* Directional = Cast<UDirectionalLightComponent>(Sun->GetLightComponent())) Directional->bAtmosphereSunLight = true;
    }
    if (!Neiva::Find<ASkyAtmosphere>(GetWorld())) GetWorld()->SpawnActor<ASkyAtmosphere>();
    if (!Neiva::Find<ASkyLight>(GetWorld()))
    {
        ASkyLight* Sky = GetWorld()->SpawnActor<ASkyLight>();
        Sky->GetLightComponent()->SetMobility(EComponentMobility::Movable);
        Sky->GetLightComponent()->SetIntensity(1.2f);
        Sky->GetLightComponent()->SetLowerHemisphereColor(FLinearColor(.20,.27,.36));
        Sky->GetLightComponent()->RecaptureSky();
    }
    Super::StartPlay();
    if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
    {
        PC->bEnableTouchEvents = true;
        if (ANeivaCharacter* Character = Cast<ANeivaCharacter>(PC->GetPawn())) Character->ResetPosition();
        PC->SetControlRotation(FRotator(-12, 20, 0));
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
    DrawText(Driving ? TEXT("WASD conducir | Espacio frenar | E salir | R reiniciar | T controles tactiles") :
        TEXT("WASD caminar | mouse mirar | Shift correr | Espacio saltar | E interactuar | R volver | T tactil"),
        FColor::White, 24, Canvas->ClipY - 65, nullptr, .87f*S);
    DrawText(TEXT("Datos: OpenStreetMap y Overture Maps / ODbL. Cobertura parcial; huellas y alturas estimadas."),
        FColor(182,191,191), 24, Canvas->ClipY - 35, nullptr, .73f*S);
    const FVector2D Button(Canvas->ClipX - 178*S, Canvas->ClipY - 170*S);
    DrawRect(FLinearColor(.05,.43,.39,.94), Button.X, Button.Y, 152*S, 58*S);
    DrawText(Driving ? TEXT("SALIR") : TEXT("INTERACTUAR"), FColor::White, Button.X + 12*S, Button.Y + 20*S, nullptr, S);
    AddHitBox(Button, FVector2D(152*S,58*S), TEXT("Interact"), true);
}
void ANeivaHUD::NotifyHitBoxClick(FName BoxName)
{
    Super::NotifyHitBoxClick(BoxName);
    if (BoxName != TEXT("Interact") || !PlayerOwner) return;
    if (ANeivaCharacter* Character = Cast<ANeivaCharacter>(PlayerOwner->GetPawn())) Character->Interact();
    else if (ANeivaCar* Car = Cast<ANeivaCar>(PlayerOwner->GetPawn())) Car->Exit();
}
