package dev.sosoph.viewmodel.mixin;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.ThirdPersonRule;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.render.ViewModelTransforms;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.HeldItemFeatureRenderer;
import net.minecraft.client.render.entity.model.BipedEntityModel;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.render.entity.model.ModelWithArms;
import net.minecraft.client.render.model.json.ModelTransformationMode;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Arm;
import net.minecraft.util.math.RotationAxis;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Third person item placement: when a rule matches the held item, the vanilla
 * "in the hand" render is replaced by one anchored somewhere else on the body.
 */
@Mixin(HeldItemFeatureRenderer.class)
public abstract class HeldItemFeatureRendererMixin {
    @Shadow
    protected abstract EntityModel<?> getContextModel();

    @Inject(method = "renderItem", at = @At("HEAD"), cancellable = true)
    private void viewmodel$placeItem(LivingEntity entity, ItemStack stack, ModelTransformationMode mode, Arm arm,
                                     MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
                                     CallbackInfo ci) {
        if (stack.isEmpty() || !(entity instanceof PlayerEntity)) {
            return;
        }

        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled) {
            return;
        }

        ThirdPersonRule rule = config.ruleFor(stack);
        if (rule == null) {
            return;
        }
        if (rule.holdWhileInUse && (entity.getHandSwingProgress(1.0F) > 0.0F || entity.isUsingItem())) {
            return;
        }
        if (rule.anchor.isHand() && rule.transform.isIdentity()) {
            return;
        }

        EntityModel<?> model = this.getContextModel();
        boolean leftHanded = arm == Arm.LEFT;

        matrices.push();
        if (rule.anchor.isHand()) {
            // Same chain vanilla uses, so the sliders only add to the normal pose.
            if (model instanceof ModelWithArms armed) {
                armed.setArmAngle(arm, matrices);
            }
            matrices.multiply(RotationAxis.POSITIVE_X.rotationDegrees(-90.0F));
            matrices.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(180.0F));
            matrices.translate((leftHanded ? -1.0F : 1.0F) / 16.0F, 0.125F, -0.625F);
        } else {
            // Follow the torso instead of the arm, so the item stays put while sneaking.
            if (model instanceof BipedEntityModel<?> biped) {
                biped.body.rotate(matrices);
            }
            rule.anchor.applyBase(matrices);
        }

        ViewModelTransforms.applyThirdPerson(matrices, rule.transform);

        MinecraftClient client = MinecraftClient.getInstance();
        client.getItemRenderer().renderItem(entity, stack, mode, leftHanded, matrices, vertexConsumers,
                entity.getWorld(), light, OverlayTexture.DEFAULT_UV, entity.getId() + mode.ordinal());
        matrices.pop();

        ci.cancel();
    }
}
