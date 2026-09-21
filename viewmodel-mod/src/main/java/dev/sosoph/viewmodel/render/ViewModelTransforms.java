package dev.sosoph.viewmodel.render;

import dev.sosoph.viewmodel.config.Transform;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;

/** Turns a {@link Transform} into matrix stack operations. */
public final class ViewModelTransforms {
    private ViewModelTransforms() {
    }

    /**
     * First person space: +X right, +Y up, -Z away from the camera. The user facing
     * "forward" slider is positive towards the world, hence the flipped Z.
     */
    public static void applyFirstPerson(PoseStack poses, Transform transform) {
        poses.translate(transform.x / 16.0F, transform.y / 16.0F, -transform.z / 16.0F);
        rotate(poses, transform);
        scale(poses, transform);
    }

    /**
     * Entity model space: mirrored and upside down, so right/up/forward all flip sign.
     * Rotations keep the same sense as the first person ones so both pages feel alike.
     */
    public static void applyThirdPerson(PoseStack poses, Transform transform) {
        poses.translate(-transform.x / 16.0F, -transform.y / 16.0F, -transform.z / 16.0F);
        rotate(poses, transform);
        scale(poses, transform);
    }

    private static void rotate(PoseStack poses, Transform transform) {
        if (transform.yaw != 0.0F) {
            poses.mulPose(Axis.YP.rotationDegrees(transform.yaw));
        }
        if (transform.pitch != 0.0F) {
            poses.mulPose(Axis.XP.rotationDegrees(transform.pitch));
        }
        if (transform.roll != 0.0F) {
            poses.mulPose(Axis.ZP.rotationDegrees(transform.roll));
        }
    }

    private static void scale(PoseStack poses, Transform transform) {
        if (transform.scale != 1.0F) {
            poses.scale(transform.scale, transform.scale, transform.scale);
        }
    }
}
