package dev.sosoph.viewmodel.mixin;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Swing speed. The duration is how many ticks one swing lasts, so a shorter duration
 * is a faster swing. Only the client's own player is touched: this is an animation
 * tweak, not a reach or attack speed change.
 */
@Mixin(LivingEntity.class)
public class LivingEntityMixin {
    @Inject(method = "getHandSwingDuration", at = @At("RETURN"), cancellable = true)
    private void viewmodel$swingSpeed(CallbackInfoReturnable<Integer> cir) {
        ViewModelConfig config = ConfigManager.get();
        if (!config.enabled || config.swingSpeed == 1.0F) {
            return;
        }
        if ((Object) this != MinecraftClient.getInstance().player) {
            return;
        }
        int duration = cir.getReturnValueI();
        cir.setReturnValue(Math.max(1, Math.round(duration / config.swingSpeed)));
    }
}
