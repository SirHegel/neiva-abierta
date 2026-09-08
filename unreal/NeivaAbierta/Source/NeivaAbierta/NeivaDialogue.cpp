#include "NeivaDialogue.h"
#include "NeivaWorld.h"

#include "Components/AudioComponent.h"
#include "Dom/JsonObject.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Sound/SoundWave.h"

namespace
{
    bool SafeId(const FString& Id)
    {
        if (Id.IsEmpty() || Id.Len() > 48) return false;
        for (TCHAR C : Id)
            if (!((C >= 'a' && C <= 'z') || (C >= '0' && C <= '9') || C == '_')) return false;
        return true;
    }
}

void UNeivaDialogueComponent::BeginPlay()
{
    Super::BeginPlay();
    FString Raw;
    TSharedPtr<FJsonObject> Data;
    const FString Path = FPaths::ProjectContentDir() / TEXT("Data/neiva-dialogue.json");
    if (!FFileHelper::LoadFileToString(Raw, *Path) || Raw.Len() > 100000 ||
        !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), Data) || !Data.IsValid())
    {
        UE_LOG(LogTemp, Error, TEXT("NeivaDialogue: missing or invalid staged dialogue manifest."));
        return;
    }
    double Version = 0;
    const TArray<TSharedPtr<FJsonValue>>* Clips = nullptr;
    if (!Data->TryGetNumberField(TEXT("schemaVersion"), Version) || Version != 1 ||
        !Data->TryGetArrayField(TEXT("clips"), Clips) || Clips->Num() > 64) return;
    for (const auto& Value : *Clips)
    {
        if (Value->Type != EJson::Object) continue;
        FString Id, Text;
        const auto Clip = Value->AsObject();
        if (!Clip->TryGetStringField(TEXT("id"), Id) || !SafeId(Id) ||
            !Clip->TryGetStringField(TEXT("text"), Text) || Text.IsEmpty() || Text.Len() > 700) continue;
        Texts.Add(Id, Text);
        const FString Asset = FString::Printf(TEXT("/Game/NeivaAssets/Dialogue/VO_%s.VO_%s"), *Id, *Id);
        if (auto* Sound = LoadObject<USoundWave>(nullptr, *Asset)) Voices.Add(Id, Sound);
        else UE_LOG(LogTemp, Warning, TEXT("NeivaDialogue: voice missing for %s; subtitles remain available."), *Id);
    }
    const TSharedPtr<FJsonObject>* Roles = nullptr;
    if (Data->TryGetObjectField(TEXT("roles"), Roles))
        for (const TCHAR* Key : {TEXT("vecino"), TEXT("comerciante"), TEXT("estudiante")})
        {
            const TSharedPtr<FJsonObject>* Role = nullptr;
            FString Label, Greeting;
            if ((*Roles)->TryGetObjectField(Key, Role) && (*Role)->TryGetStringField(TEXT("label"), Label) &&
                (*Role)->TryGetStringField(TEXT("greeting"), Greeting) && Texts.Contains(Greeting))
            { RoleLabels.Add(Label); RoleGreetings.Add(Greeting); }
        }
    const TArray<TSharedPtr<FJsonValue>>* Topics = nullptr;
    if (Data->TryGetArrayField(TEXT("topics"), Topics))
        for (const auto& Value : *Topics)
        {
            if (TopicLabels.Num() >= 4 || Value->Type != EJson::Object) break;
            FString Label, Clip;
            if (Value->AsObject()->TryGetStringField(TEXT("label"), Label) &&
                Value->AsObject()->TryGetStringField(TEXT("clip"), Clip) && Texts.Contains(Clip))
            { TopicLabels.Add(Label); TopicClips.Add(Clip); }
        }
    UE_LOG(LogTemp, Display, TEXT("NeivaDialogue: loaded %d texts, %d voices, %d roles and %d topics. Authored fictional dialogue; synthetic Spanish voice."),
        Texts.Num(), Voices.Num(), RoleLabels.Num(), TopicLabels.Num());
}

bool UNeivaDialogueComponent::Start(ANeivaPedestrian* Person)
{
    if (!IsValid(Person) || RoleLabels.IsEmpty() || TopicLabels.IsEmpty()) return false;
    Close();
    Speaker = Person;
    bConversationOpen = true;
    const int32 Role = FMath::Abs(Person->GetDialogueSeed()) % RoleLabels.Num();
    SpeakerLabel = RoleLabels[Role];
    PlayClip(RoleGreetings[Role]);
    return true;
}

void UNeivaDialogueComponent::PlayClip(const FString& Id)
{
    if (Voice) { Voice->Stop(); Voice = nullptr; }
    CurrentClip = Id;
    CurrentText = Texts.FindRef(Id);
    if (const auto* Sound = Voices.Find(Id); Sound && *Sound)
        Voice = UGameplayStatics::SpawnSound2D(this, Sound->Get(), .85f, 1.f, 0.f, nullptr, false, true);
    UE_LOG(LogTemp, Display, TEXT("NeivaDialogue: speaker=%s clip=%s voice_started=%d"),
        *GetNameSafe(Speaker.Get()), *Id, IsVoicePlaying());
}

bool UNeivaDialogueComponent::SelectTopic(int32 Index)
{
    if (!IsActive() || !TopicClips.IsValidIndex(Index)) return false;
    PlayClip(TopicClips[Index]);
    return true;
}

bool UNeivaDialogueComponent::IsVoicePlaying() const { return Voice && Voice->IsPlaying(); }
ANeivaPedestrian* UNeivaDialogueComponent::GetSpeaker() const { return Speaker.Get(); }

void UNeivaDialogueComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    Close();
    Super::EndPlay(EndPlayReason);
}

void UNeivaDialogueComponent::Close()
{
    if (Voice) { Voice->Stop(); Voice = nullptr; }
    Speaker.Reset(); CurrentText.Reset(); CurrentClip.Reset(); SpeakerLabel.Reset();
    bConversationOpen = false;
}
