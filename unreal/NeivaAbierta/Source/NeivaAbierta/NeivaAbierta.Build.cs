using UnrealBuildTool;

public class NeivaAbierta : ModuleRules
{
    public NeivaAbierta(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore", "Json", "PhysicsCore", "ProceduralMeshComponent"
        });
    }
}
