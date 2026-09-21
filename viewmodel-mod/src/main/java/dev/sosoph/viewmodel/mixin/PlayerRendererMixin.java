package dev.sosoph.viewmodel.mixin;

import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.render.HeldItemInfo;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.entity.PlayerRenderer;
import net.minecraft.client.renderer.entity.state.PlayerRenderState;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Copies what the item layer needs onto the render state, once per frame per player. */
@Mixin(PlayerRenderer.class)
public class PlayerRendererMixin {
    @Inject(method = "extractRenderState", at = @At("TAIL"))
    private void viewmodel$captureHeldItems(AbstractClientPlayer player, PlayerRenderState state,
                                            float partialTick, CallbackInfo ci) {
        if (!(state instanceof HeldItemInfo info)) {
            return;
        }

        ItemStack main = player.getMainHandItem();
        ItemStack off = player.getOffhandItem();
        boolean mainIsRight = player.getMainArm() == HumanoidArm.RIGHT;

        String mainId = main.isEmpty() ? "" : ViewModelConfig.idOf(main.getItem());
        String offId = off.isEmpty() ? "" : ViewModelConfig.idOf(off.getItem());

        info.viewmodel$setItemIds(mainIsRight ? mainId : offId, mainIsRight ? offId : mainId);
        info.viewmodel$setItemInUse(player.getAttackAnim(partialTick) > 0.0F || player.isUsingItem());
    }
}
