"""Remove temporary API-key-bearing preview actors before saving a level."""
import unreal

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
tag = unreal.Name("NeivaGoogleTemporaryPreview")
for actor in actors.get_all_level_actors():
    if tag in actor.tags:
        if hasattr(actor, "set_url"):
            actor.set_url("")
        actors.destroy_actor(actor)
unreal.log("Temporary Google preview removed. Keep API keys outside saved maps and source control.")
