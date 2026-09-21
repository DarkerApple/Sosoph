package dev.sosoph.viewmodel.mixin;

import com.mojang.blaze3d.vertex.PoseStack;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.render.ViewModelTransforms;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.FirstPersonHandsAndItemsRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Offsets the first person view model, per hand. */
@Mixin(FirstPersonHandsAndItemsRenderer.class)
public class FirstPersonRendererMixin {
    /**
     * Both hands are submitted inside one push/pop by the caller, so the offset has to
     * be pushed and popped around each individual hand instead.
     */
    @Unique
    private boolean viewmodel$pushed;

    @Inject(method = "submitArmWithItem", at = @At("HEAD"))
    private void viewmodel$pushOffset(AbstractClientPlayer player, float partialTick, float pitch,
                                      InteractionHand hand, float swingProgress, ItemStack stack,
                                      float equipProgress, PoseStack poses, SubmitNodeCollector collector,
                                      int light, CallbackInfo ci) {
        this.viewmodel$pushed = false;

        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || stack.isEmpty() || config.isBlacklisted(stack)) {
            return;
        }

        Transform transform = config.handTransform(hand == InteractionHand.MAIN_HAND);
        if (transform.isIdentity()) {
            return;
        }

        poses.pushPose();
        ViewModelTransforms.applyFirstPerson(poses, transform);
        this.viewmodel$pushed = true;
    }

    @Inject(method = "submitArmWithItem", at = @At("RETURN"))
    private void viewmodel$popOffset(AbstractClientPlayer player, float partialTick, float pitch,
                                     InteractionHand hand, float swingProgress, ItemStack stack,
                                     float equipProgress, PoseStack poses, SubmitNodeCollector collector,
                                     int light, CallbackInfo ci) {
        if (this.viewmodel$pushed) {
            poses.popPose();
            this.viewmodel$pushed = false;
        }
    }

    /** Scales how far the swing animation travels, without touching its timing. */
    @ModifyVariable(method = "submitArmWithItem", at = @At("HEAD"), argsOnly = true, index = 5)
    private float viewmodel$swingAmount(float swingProgress) {
        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || config.swingAmount == 1.0F) {
            return swingProgress;
        }
        return Mth.clamp(swingProgress * config.swingAmount, 0.0F, 1.0F);
    }
}
