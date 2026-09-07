#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "TimerManager.h"
#include "NeivaPlayerController.generated.h"

// Controller-owned pause keeps working when the player possesses a vehicle.
UCLASS()
class NEIVAABIERTA_API ANeivaPlayerController : public APlayerController
{
    GENERATED_BODY()
public:
    virtual void BeginPlay() override;
    virtual void SetupInputComponent() override;
    void TogglePauseMenu();
    void ResumeGame();
    void QuitToDesktop();
    UFUNCTION(exec) void NeivaState();
private:
    void ApplyGameInput();
    void ResetPawnInput();
    void AuditState();
    FTimerHandle AuditTimer;
    int32 AuditSamplesRemaining = 0;
};
