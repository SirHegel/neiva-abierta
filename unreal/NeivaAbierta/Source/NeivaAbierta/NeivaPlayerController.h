#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "TimerManager.h"
#include "NeivaPlayerController.generated.h"

class ANeivaPedestrian;
class UNeivaDialogueComponent;

// Controller-owned pause keeps working when the player possesses a vehicle.
UCLASS()
class NEIVAABIERTA_API ANeivaPlayerController : public APlayerController
{
    GENERATED_BODY()
public:
    ANeivaPlayerController();
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    virtual void PlayerTick(float DeltaTime) override;
    virtual void SetupInputComponent() override;
    void TogglePauseMenu();
    void ResumeGame();
    void QuitToDesktop();
    bool BeginConversation(ANeivaPedestrian* Person);
    void CloseConversation();
    void SelectConversationTopic(int32 Index);
    void OpenDeveloperContact();
    UNeivaDialogueComponent* GetDialogue() const { return Dialogue; }
    UFUNCTION(exec) void NeivaState();
    UFUNCTION(exec) void NeivaLook(float Yaw, float Pitch);
    UFUNCTION(exec) void NeivaClimate(FString Mode);
private:
    void TopicOne() { SelectConversationTopic(0); }
    void TopicTwo() { SelectConversationTopic(1); }
    void TopicThree() { SelectConversationTopic(2); }
    void TopicFour() { SelectConversationTopic(3); }
    UPROPERTY() TObjectPtr<UNeivaDialogueComponent> Dialogue;
    double LastConversationInput = 0;
    void ApplyGameInput();
    void ResetPawnInput();
    void AuditState();
    FTimerHandle AuditTimer;
    int32 AuditSamplesRemaining = 0;
};
