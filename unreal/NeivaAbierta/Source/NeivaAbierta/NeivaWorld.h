#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Character.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "NeivaWorld.generated.h"

class UProceduralMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UStaticMeshComponent;
class UBoxComponent;
class UMaterialInterface;
class USkeletalMesh;
class UStaticMesh;
class UAnimSequence;
class UTextureCube;

// Runtime asset references are editable in DefaultGame.ini. No editor module
// is linked into the game, and missing art never becomes a block avatar.
UCLASS(Config=Game, DefaultConfig)
class NEIVAABIERTA_API UNeivaVisualSettings : public UObject
{
    GENERATED_BODY()
public:
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<USkeletalMesh> CharacterMesh;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<UStaticMesh> CarMesh;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<UTextureCube> EnvironmentCube;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<UAnimSequence> IdleAnimation;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<UAnimSequence> WalkAnimation;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") TSoftObjectPtr<UAnimSequence> RunAnimation;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") FRotator CharacterRotation = FRotator::ZeroRotator;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") FRotator CarRotation = FRotator::ZeroRotator;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") float CharacterHeightCm = 180;
    UPROPERTY(Config, EditAnywhere, Category="Neiva|Visual") float CarLengthCm = 420;
};

UCLASS()
class NEIVAABIERTA_API ANeivaCity : public AActor
{
    GENERATED_BODY()
public:
    ANeivaCity();
    void BuildCity();
    FVector SpawnPoint = FVector(0, 0, 150);
    FVector CarPoint = FVector(700, 0, 60);
    float CarYaw = 0;
    FVector StudioPoint = FVector(0, 1400, 0);
    FString Status = TEXT("Cargando datos abiertos...");
    UPROPERTY(EditAnywhere, Category="Neiva") bool bGenerateMapGeometry = true;
    // Zero imports the entire dataset. Nonzero is an explicitly selected preview radius.
    UPROPERTY(EditAnywhere, Category="Neiva", meta=(ClampMin="0")) float BuildingRadiusMeters = 0;
    UPROPERTY(EditAnywhere, Category="Neiva", meta=(ClampMin="100", ClampMax="2000")) float BuildingTileSizeMeters = 500;
private:
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Mesh;
    UPROPERTY() TArray<TObjectPtr<UProceduralMeshComponent>> BuildingMeshes;
    UPROPERTY() TObjectPtr<UMaterialInterface> Surface;
    UPROPERTY() TObjectPtr<UMaterialInterface> UpperSurface;
    UPROPERTY() TObjectPtr<UMaterialInterface> RoadMaterial;
    UPROPERTY() TObjectPtr<UMaterialInterface> RoofMaterial;
    UPROPERTY() TObjectPtr<UMaterialInterface> GrassMaterial;
    UPROPERTY() TObjectPtr<UMaterialInterface> WaterMaterial;
    UPROPERTY() TObjectPtr<UMaterialInterface> GroundMaterial;
    bool bBuilt = false;
};

UCLASS()
class NEIVAABIERTA_API ANeivaCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    ANeivaCharacter();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    void Interact();
    void ResetPosition();
    void ToggleTouchControls();
private:
    void Forward(float Value);
    void Right(float Value);
    void LookYaw(float Value);
    void LookPitch(float Value);
    void SprintOn();
    void SprintOff();
    UPROPERTY() TObjectPtr<USpringArmComponent> Arm;
    UPROPERTY() TObjectPtr<UCameraComponent> Camera;
    UPROPERTY() TObjectPtr<UAnimSequence> IdleAnimation;
    UPROPERTY() TObjectPtr<UAnimSequence> WalkAnimation;
    UPROPERTY() TObjectPtr<UAnimSequence> RunAnimation;
    UPROPERTY() TObjectPtr<UAnimSequence> ActiveAnimation;
};

UCLASS()
class NEIVAABIERTA_API ANeivaCar : public APawn
{
    GENERATED_BODY()
public:
    ANeivaCar();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    void Enter(ANeivaCharacter* Character);
    void Exit();
    void ResetPosition();
    void ToggleTouchControls();
    float Speed = 0;
private:
    void Throttle(float Value);
    void Steer(float Value);
    void BrakeOn();
    void BrakeOff();
    UPROPERTY() TObjectPtr<UBoxComponent> Collision;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Visual;
    UPROPERTY() TObjectPtr<USpringArmComponent> Arm;
    UPROPERTY() TObjectPtr<UCameraComponent> Camera;
    UPROPERTY() TObjectPtr<ANeivaCharacter> Passenger;
    float ThrottleInput = 0;
    float SteeringInput = 0;
    bool bBrake = false;
};

UCLASS()
class NEIVAABIERTA_API ANeivaGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    ANeivaGameMode();
    virtual void StartPlay() override;
};

UCLASS()
class NEIVAABIERTA_API ANeivaHUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
    virtual void NotifyHitBoxClick(FName BoxName) override;
};
