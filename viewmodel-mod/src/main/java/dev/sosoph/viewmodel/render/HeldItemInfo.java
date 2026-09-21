package dev.sosoph.viewmodel.render;

import net.minecraft.world.entity.HumanoidArm;

/**
 * Third person rendering works off render states, which are extracted once per frame
 * and no longer carry the entity or its item stacks. This duck interface is mixed into
 * the player render state so the item layer can still tell what is being held.
 */
public interface HeldItemInfo {
    String viewmodel$itemIdFor(HumanoidArm arm);

    void viewmodel$setItemIds(String rightArmId, String leftArmId);

    boolean viewmodel$isItemInUse();

    void viewmodel$setItemInUse(boolean inUse);
}
