#include "NeivaWeatherMaterialLibrary.h"

#if WITH_EDITOR
#include "MaterialExpressionIO.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"
#endif

bool UNeivaWeatherMaterialLibrary::ConnectRainOffset(UMaterial* Material, UMaterialExpression* Expression)
{
#if WITH_EDITOR
    if (!Material || !Expression || Expression->Material != Material) return false;
    FExpressionInput* Input = Material->GetExpressionInputForProperty(MP_WorldPositionOffset);
    if (!Input) return false;
    Material->Modify();
    Input->Connect(0, Expression);
    // Caller recompiles after finishing all the other material connections.
    return Input->Expression == Expression && Input->OutputIndex == 0;
#else
    // No editor API or editor-module dependency is linked into the game.
    (void)Material;
    (void)Expression;
    return false;
#endif
}
