package dev.sosoph.viewmodel.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.ThirdPersonRule;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.render.HeldItemInfo;
import dev.sosoph.viewmodel.render.ViewModelTransforms;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.layers.ItemInHandLayer;
import net.minecraft.client.renderer.entity.state.ArmedEntityRenderState;
import net.minecraft.client.renderer.item.ItemStackRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.world.entity.HumanoidArm;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Third person item placement: when a rule matches the held item, the vanilla
 * "in the hand" submit is replaced by one anchored somewhere else on the body.
 */
@Mixin(ItemInHandLayer.class)
public abstract class ItemInHandLayerMixin {
    @Shadow
    protected abstract EntityModel<?> getParentModel();

    @Inject(method = "submitArmWithItem", at = @At("HEAD"), cancellable = true)
    private void viewmodel$placeItem(ArmedEntityRenderState state, ItemStackRenderState itemState,
                                     HumanoidArm arm, PoseStack poses, SubmitNodeCollector collector,
                                     int light, CallbackInfo ci) {
        if (itemState.isEmpty() || !(state instanceof HeldItemInfo info)) {
            return;
        }

        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || !config.thirdPersonEnabled) {
            return;
        }

        ThirdPersonRule rule = config.ruleForId(info.viewmodel$itemIdFor(arm));
        if (rule == null) {
            return;
        }
        if (rule.holdWhileInUse && info.viewmodel$isItemInUse()) {
            return;
        }
        if (rule.anchor.isHand() && rule.transform.isIdentity()) {
            return;
        }

        poses.pushPose();
        if (rule.anchor.isHand()) {
            // The same chain vanilla uses, so the sliders only add to the normal pose.
            if (this.getParentModel() instanceof HumanoidModel<?> humanoid) {
                humanoid.translateToHand(arm, poses);
            }
            poses.mulPose(Axis.XP.rotationDegrees(-90.0F));
            poses.mulPose(Axis.YP.rotationDegrees(180.0F));
            poses.translate((arm == HumanoidArm.LEFT ? -1.0F : 1.0F) / 16.0F, 0.125F, -0.625F);
        } else {
            // Follow the torso instead of the arm, so the item stays put while sneaking.
            if (this.getParentModel() instanceof HumanoidModel<?> humanoid) {
                humanoid.body.translateAndRotate(poses);
            }
            rule.anchor.applyBase(poses);
        }

        ViewModelTransforms.applyThirdPerson(poses, rule.transform);
        itemState.submit(poses, collector, light, OverlayTexture.NO_OVERLAY, 0);
        poses.popPose();

        ci.cancel();
    }
}
