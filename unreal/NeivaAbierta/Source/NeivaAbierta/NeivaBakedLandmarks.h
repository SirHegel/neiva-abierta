#pragma once

#include "CoreMinimal.h"

class AActor;
class USceneComponent;
class FJsonObject;

namespace Neiva
{
    // All-or-nothing: returns false without adding components when the complete
    // bake, source fingerprint, origin or any asset is unavailable/incompatible.
    // On success also creates the three labels. The caller must skip its entire
    // procedural landmark path, including labels, and use ReplacedBuildingIds.
    bool TryBuildBakedLandmarks(AActor* Owner, USceneComponent* Parent,
        const TSharedPtr<FJsonObject>& MapData, TSet<FString>& ReplacedBuildingIds);
}
