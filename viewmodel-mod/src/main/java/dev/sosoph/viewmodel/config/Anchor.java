package dev.sosoph.viewmodel.config;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import net.minecraft.network.chat.Component;

/**
 * Where a third person item is attached to the body.
 *
 * <p>The base transforms below work in entity model space, which is mirrored and
 * upside down compared to world space: +X is the entity's left, +Y is down and +Z is
 * behind it. Every anchor ends by orienting the item exactly the way a held item is
 * oriented, so the sliders on top of it always behave the same no matter the anchor.
 */
public enum Anchor {
    HAND("hand", 0.0F, 0.0F, 0.0F),
    WAIST_RIGHT("waist_right", -4.5F, 10.0F, 0.0F),
    WAIST_LEFT("waist_left", 4.5F, 10.0F, 0.0F),
    BACK("back", 0.0F, 6.0F, 3.0F),
    SHOULDER_RIGHT("shoulder_right", -5.0F, 1.0F, 1.5F),
    SHOULDER_LEFT("shoulder_left", 5.0F, 1.0F, 1.5F);

    private final String id;
    private final float modelX;
    private final float modelY;
    private final float modelZ;

    Anchor(String id, float modelX, float modelY, float modelZ) {
        this.id = id;
        this.modelX = modelX;
        this.modelY = modelY;
        this.modelZ = modelZ;
    }

    public String getId() {
        return this.id;
    }

    public Component getDisplayName() {
        return Component.translatable("viewmodel.anchor." + this.id);
    }

    public boolean isHand() {
        return this == HAND;
    }

    /** Moves the matrix stack from the body origin to this attachment point. */
    public void applyBase(PoseStack poses) {
        poses.translate(this.modelX / 16.0F, this.modelY / 16.0F, this.modelZ / 16.0F);
        poses.mulPose(Axis.XP.rotationDegrees(-90.0F));
        poses.mulPose(Axis.YP.rotationDegrees(180.0F));
    }

    public Anchor next() {
        Anchor[] values = values();
        return values[(this.ordinal() + 1) % values.length];
    }

    public Anchor previous() {
        Anchor[] values = values();
        return values[(this.ordinal() + values.length - 1) % values.length];
    }
}
