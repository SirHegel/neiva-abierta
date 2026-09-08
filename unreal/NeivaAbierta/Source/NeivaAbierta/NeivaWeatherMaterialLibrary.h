#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "NeivaWeatherMaterialLibrary.generated.h"

class UMaterial;
class UMaterialExpression;

// UE 5.5 marks MP_WorldPositionOffset Hidden, so Python cannot name or cast
// that enum entry. This narrow bridge uses the actual C++ enumerator instead.
UCLASS()
class NEIVAABIERTA_API UNeivaWeatherMaterialLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="Neiva|Editor", meta=(DevelopmentOnly))
    static bool ConnectRainOffset(UMaterial* Material, UMaterialExpression* Expression);
};
