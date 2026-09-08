#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "NeivaDialogue.generated.h"

class ANeivaPedestrian;
class UAudioComponent;
class USoundWave;

// Authored fictional conversations, loaded from the same manifest as the
// offline-generated Spanish voice clips. No network or live TTS dependency.
UCLASS()
class NEIVAABIERTA_API UNeivaDialogueComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    bool Start(ANeivaPedestrian* Person);
    bool SelectTopic(int32 Index);
    void Close();
    bool IsActive() const { return bConversationOpen; }
    ANeivaPedestrian* GetSpeaker() const;
    const FString& GetSpeakerLabel() const { return SpeakerLabel; }
    const FString& GetText() const { return CurrentText; }
    const TArray<FString>& GetTopics() const { return TopicLabels; }
    bool ShowsContact() const { return CurrentClip == TEXT("contacto"); }
    bool IsVoicePlaying() const;
private:
    bool bConversationOpen = false;
    void PlayClip(const FString& Id);
    TMap<FString, FString> Texts;
    TArray<FString> TopicClips;
    TArray<FString> TopicLabels;
    TArray<FString> RoleLabels;
    TArray<FString> RoleGreetings;
    FString SpeakerLabel, CurrentText, CurrentClip;
    UPROPERTY() TMap<FString, TObjectPtr<USoundWave>> Voices;
    UPROPERTY() TObjectPtr<UAudioComponent> Voice;
    TWeakObjectPtr<ANeivaPedestrian> Speaker;
};
