#include "NeivaPlayerController.h"
#include "NeivaWorld.h"
#include "NeivaDialogue.h"
#include "NeivaWeather.h"

#include "Components/InputComponent.h"
#include "Components/CapsuleComponent.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerInput.h"
#include "InputCoreTypes.h"
#include "HAL/PlatformProcess.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "TimerManager.h"

ANeivaPlayerController::ANeivaPlayerController()
{
    Dialogue = CreateDefaultSubobject<UNeivaDialogueComponent>(TEXT("Conversation"));
}

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
    for (TActorIterator<ANeivaPedestrian> It(GetWorld()); It; ++It)
        UE_LOG(LogTemp, Display, TEXT("NeivaState: pedestrian=%s role_seed=%d location_cm=%s velocity_cm_s=%s"),
            *It->GetName(), It->GetDialogueSeed(), *It->GetActorLocation().ToString(), *It->GetVelocity().ToString());
    for (TActorIterator<ANeivaWeather> It(GetWorld()); It; ++It)
        UE_LOG(LogTemp, Display, TEXT("NeivaState: weather_ready=%d phase=%s rain=%.6f wetness=%.6f drops=%d next_seconds=%.6f"),
            It->IsWeatherReady(), *It->GetPhaseLabel(), It->GetRainAmount(), It->GetWetness(),
            It->GetRainInstanceCount(), It->GetSecondsUntilChange());
    if (Dialogue)
        UE_LOG(LogTemp, Display, TEXT("NeivaState: conversation=%d speaker=%s voice_playing=%d move_ignored=%d look_ignored=%d"),
            Dialogue->IsActive(), *GetNameSafe(Dialogue->GetSpeaker()), Dialogue->IsVoicePlaying(), IsMoveInputIgnored(), IsLookInputIgnored());
}

void ANeivaPlayerController::NeivaClimate(FString Mode)
{
    if (!FParse::Param(FCommandLine::Get(), TEXT("NeivaAudit")) || IsPaused()) return;
    const FString Key = Mode.ToLower();
    if (Key != TEXT("dry") && Key != TEXT("rain") && Key != TEXT("cycle")) return;
    for (TActorIterator<ANeivaWeather> It(GetWorld()); It; ++It)
        It->SetWeatherMode(Key == TEXT("rain") ? ENeivaWeatherMode::Rain :
            Key == TEXT("dry") ? ENeivaWeatherMode::Dry : ENeivaWeatherMode::Cycle);
    NeivaState();
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
    InputComponent->BindKey(EKeys::One, IE_Pressed, this, &ANeivaPlayerController::TopicOne);
    InputComponent->BindKey(EKeys::Two, IE_Pressed, this, &ANeivaPlayerController::TopicTwo);
    InputComponent->BindKey(EKeys::Three, IE_Pressed, this, &ANeivaPlayerController::TopicThree);
    InputComponent->BindKey(EKeys::Four, IE_Pressed, this, &ANeivaPlayerController::TopicFour);
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
    if (Dialogue->IsActive()) { CloseConversation(); return; }
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
    CloseConversation();
    UKismetSystemLibrary::QuitGame(this, this, EQuitPreference::Quit, false);
}

void ANeivaPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    CloseConversation();
    Super::EndPlay(EndPlayReason);
}

void ANeivaPlayerController::PlayerTick(float DeltaTime)
{
    Super::PlayerTick(DeltaTime);
    if (Dialogue->IsActive() && (!GetPawn() || !IsValid(Dialogue->GetSpeaker()) ||
        FVector::DistSquared(GetPawn()->GetActorLocation(), Dialogue->GetSpeaker()->GetActorLocation()) > 500.f * 500.f ||
        GetWorld()->GetTimeSeconds() - LastConversationInput > 75.f)) CloseConversation();
}

bool ANeivaPlayerController::BeginConversation(ANeivaPedestrian* Person)
{
    auto* Character = Cast<ANeivaCharacter>(GetPawn());
    if (IsPaused() || Dialogue->IsActive() || !Character || !IsValid(Person) ||
        FVector::DistSquared(Character->GetActorLocation(), Person->GetActorLocation()) > 320.f * 320.f ||
        !LineOfSightTo(Person) || !Dialogue->Start(Person)) return false;
    ResetPawnInput();
    Character->GetCharacterMovement()->StopMovementImmediately();
    Person->SetConversationPartner(Character);
    SetIgnoreMoveInput(true);
    SetIgnoreLookInput(true);
    bShowMouseCursor = true; bEnableClickEvents = true;
    FInputModeGameAndUI Mode;
    Mode.SetHideCursorDuringCapture(false);
    Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
    SetInputMode(Mode);
    LastConversationInput = GetWorld()->GetTimeSeconds();
    UE_LOG(LogTemp, Display, TEXT("NeivaConversation: begin person=%s distance_cm=%.2f"),
        *Person->GetName(), FVector::Dist(Character->GetActorLocation(), Person->GetActorLocation()));
    return true;
}

void ANeivaPlayerController::CloseConversation()
{
    if (!Dialogue || !Dialogue->IsActive()) return;
    if (auto* Person = Dialogue->GetSpeaker()) Person->SetConversationPartner(nullptr);
    Dialogue->Close();
    ResetPawnInput();
    SetIgnoreMoveInput(false); SetIgnoreLookInput(false);
    if (!IsPaused()) ApplyGameInput();
    UE_LOG(LogTemp, Display, TEXT("NeivaConversation: closed; movement and route resumed."));
}

void ANeivaPlayerController::SelectConversationTopic(int32 Index)
{
    if (!IsPaused() && Dialogue && Dialogue->SelectTopic(Index))
        LastConversationInput = GetWorld()->GetTimeSeconds();
}

void ANeivaPlayerController::OpenDeveloperContact()
{
    if (!Dialogue || !Dialogue->IsActive() || !Dialogue->ShowsContact() || IsPaused()) return;
    FPlatformProcess::LaunchURL(TEXT("mailto:alvarezruizj289@gmail.com?subject=Proyecto%20desde%20Neiva%20Abierta"), nullptr, nullptr);
}
