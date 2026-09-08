#include "NeivaPlayerController.h"
#include "NeivaWorld.h"

#include "Components/InputComponent.h"
#include "Components/CapsuleComponent.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerInput.h"
#include "InputCoreTypes.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "TimerManager.h"

void ANeivaPlayerController::BeginPlay()
{
    Super::BeginPlay();
    bEnableTouchEvents = true;
    ApplyGameInput();
    if (FParse::Param(FCommandLine::Get(), TEXT("NeivaAudit")))
    {
        AuditSamplesRemaining = 15;
        GetWorldTimerManager().SetTimer(AuditTimer, this, &ANeivaPlayerController::AuditState, 1.f, true);
    }
}

void ANeivaPlayerController::NeivaState()
{
    const APawn* Pawn = GetPawn();
    UE_LOG(LogTemp, Display, TEXT("NeivaState: world_seconds=%.3f pawn=%s location_cm=%s actor_rotation=%s control_rotation=%s velocity_cm_s=%s"),
        GetWorld()->GetTimeSeconds(), *GetNameSafe(Pawn),
        Pawn ? *Pawn->GetActorLocation().ToString() : TEXT("none"),
        Pawn ? *Pawn->GetActorRotation().ToString() : TEXT("none"),
        *GetControlRotation().ToString(), Pawn ? *Pawn->GetVelocity().ToString() : TEXT("none"));
    if (const auto* Character = Cast<ANeivaCharacter>(Pawn))
        UE_LOG(LogTemp, Display, TEXT("NeivaState: capsule_radius_cm=%.3f capsule_half_height_cm=%.3f movement_mode=%d"),
            Character->GetCapsuleComponent()->GetScaledCapsuleRadius(),
            Character->GetCapsuleComponent()->GetScaledCapsuleHalfHeight(),
            static_cast<int32>(Character->GetCharacterMovement()->MovementMode));
    for (TActorIterator<ANeivaCar> It(GetWorld()); It; ++It)
        UE_LOG(LogTemp, Display, TEXT("NeivaState: car=%s location_cm=%s yaw=%.3f speed_property=%.3f passenger=%s"),
            *It->GetName(), *It->GetActorLocation().ToString(), It->GetActorRotation().Yaw,
            It->Speed, *GetNameSafe(It->GetPassenger()));
}

void ANeivaPlayerController::AuditState()
{
    NeivaState();
    if (--AuditSamplesRemaining <= 0) GetWorldTimerManager().ClearTimer(AuditTimer);
}

void ANeivaPlayerController::NeivaLook(float Yaw, float Pitch)
{
    // Reproducible review framing, opt-in only. Never teleports, disables
    // collision or changes movement mode as CheatManager::BugItGo would.
    if (!FParse::Param(FCommandLine::Get(), TEXT("NeivaAudit")) ||
        !FMath::IsFinite(Yaw) || !FMath::IsFinite(Pitch) || IsPaused()) return;
    SetControlRotation(FRotator(FMath::Clamp(Pitch, -70.f, 60.f), FMath::UnwindDegrees(Yaw), 0));
    NeivaState();
}

void ANeivaPlayerController::SetupInputComponent()
{
    Super::SetupInputComponent();
    for (const FKey& Key : {EKeys::Escape, EKeys::P, EKeys::Gamepad_Special_Right})
    {
        auto& Binding = InputComponent->BindKey(Key, IE_Pressed, this,
            &ANeivaPlayerController::TogglePauseMenu);
        Binding.bExecuteWhenPaused = true;
    }
}

void ANeivaPlayerController::ApplyGameInput()
{
    bShowMouseCursor = false;
    bEnableClickEvents = false;
    FInputModeGameOnly Mode;
    Mode.SetConsumeCaptureMouseDown(false);
    SetInputMode(Mode);
}

void ANeivaPlayerController::TogglePauseMenu()
{
    if (IsPaused()) { ResumeGame(); return; }
    if (!SetPause(true)) return;
    ResetPawnInput();
    SetIgnoreLookInput(true);
    SetIgnoreMoveInput(true);
    bShowMouseCursor = true;
    bEnableClickEvents = true;
    FInputModeGameAndUI Mode;
    Mode.SetHideCursorDuringCapture(false);
    Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
    SetInputMode(Mode);
}

void ANeivaPlayerController::ResumeGame()
{
    if (!IsPaused() || !SetPause(false)) return;
    ResetPawnInput();
    SetIgnoreLookInput(false);
    SetIgnoreMoveInput(false);
    ApplyGameInput();
}

void ANeivaPlayerController::ResetPawnInput()
{
    if (PlayerInput) PlayerInput->FlushPressedKeys();
    // Key-state flushing does not invoke every released action. Clear held
    // sprint/jump/brake/throttle explicitly, while preserving vehicle momentum.
    if (auto* Character = Cast<ANeivaCharacter>(GetPawn())) Character->ResetControlInput();
    else if (auto* Car = Cast<ANeivaCar>(GetPawn())) Car->ResetControlInput();
}

void ANeivaPlayerController::QuitToDesktop()
{
    UKismetSystemLibrary::QuitGame(this, this, EQuitPreference::Quit, false);
}
