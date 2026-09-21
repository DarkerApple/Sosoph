package dev.sosoph.viewmodel.mixin;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.render.ViewModelTransforms;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.item.HeldItemRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Hand;
import net.minecraft.util.math.MathHelper;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Offsets the first person view model, per hand. */
@Mixin(HeldItemRenderer.class)
public class HeldItemRendererMixin {
    /**
     * Both hands are rendered inside one push/pop by the caller, so the offset has to
     * be pushed and popped around each individual hand instead.
     */
    @Unique
    private boolean viewmodel$pushed;

    @Inject(method = "renderFirstPersonItem", at = @At("HEAD"))
    private void viewmodel$pushOffset(AbstractClientPlayerEntity player, float tickDelta, float pitch, Hand hand,
                                      float swingProgress, ItemStack item, float equipProgress, MatrixStack matrices,
                                      VertexConsumerProvider vertexConsumers, int light, CallbackInfo ci) {
        this.viewmodel$pushed = false;

        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || item.isEmpty() || config.isBlacklisted(item)) {
            return;
        }

        Transform transform = config.handTransform(hand == Hand.MAIN_HAND);
        if (transform.isIdentity()) {
            return;
        }

        matrices.push();
        ViewModelTransforms.applyFirstPerson(matrices, transform);
        this.viewmodel$pushed = true;
    }

    @Inject(method = "renderFirstPersonItem", at = @At("RETURN"))
    private void viewmodel$popOffset(AbstractClientPlayerEntity player, float tickDelta, float pitch, Hand hand,
                                     float swingProgress, ItemStack item, float equipProgress, MatrixStack matrices,
                                     VertexConsumerProvider vertexConsumers, int light, CallbackInfo ci) {
        if (this.viewmodel$pushed) {
            matrices.pop();
            this.viewmodel$pushed = false;
        }
    }

    /** Scales how far the swing animation travels, without touching its timing. */
    @ModifyVariable(method = "renderFirstPersonItem", at = @At("HEAD"), argsOnly = true, index = 5)
    private float viewmodel$swingAmount(float swingProgress) {
        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || config.swingAmount == 1.0F) {
            return swingProgress;
        }
        return MathHelper.clamp(swingProgress * config.swingAmount, 0.0F, 1.0F);
    }
}
