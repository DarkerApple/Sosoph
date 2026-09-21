package dev.sosoph.viewmodel.mixin;

import dev.sosoph.viewmodel.render.HeldItemInfo;
import net.minecraft.client.renderer.entity.state.PlayerRenderState;
import net.minecraft.world.entity.HumanoidArm;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;

/** Carries the held item ids through to the item layer. */
@Mixin(PlayerRenderState.class)
public class PlayerRenderStateMixin implements HeldItemInfo {
    @Unique
    private String viewmodel$rightArmId = "";

    @Unique
    private String viewmodel$leftArmId = "";

    @Unique
    private boolean viewmodel$itemInUse;

    @Override
    public String viewmodel$itemIdFor(HumanoidArm arm) {
        return arm == HumanoidArm.RIGHT ? this.viewmodel$rightArmId : this.viewmodel$leftArmId;
    }

    @Override
    public void viewmodel$setItemIds(String rightArmId, String leftArmId) {
        this.viewmodel$rightArmId = rightArmId;
        this.viewmodel$leftArmId = leftArmId;
    }

    @Override
    public boolean viewmodel$isItemInUse() {
        return this.viewmodel$itemInUse;
    }

    @Override
    public void viewmodel$setItemInUse(boolean inUse) {
        this.viewmodel$itemInUse = inUse;
    }
}
