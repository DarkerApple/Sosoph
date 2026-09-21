package dev.sosoph.viewmodel.render;

import dev.sosoph.viewmodel.config.Transform;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.RotationAxis;

/** Turns a {@link Transform} into matrix stack operations. */
public final class ViewModelTransforms {
    private ViewModelTransforms() {
    }

    /**
     * First person space: +X right, +Y up, -Z away from the camera. The user facing
     * "forward" slider is positive towards the world, hence the flipped Z.
     */
    public static void applyFirstPerson(MatrixStack matrices, Transform transform) {
        matrices.translate(transform.x / 16.0F, transform.y / 16.0F, -transform.z / 16.0F);
        rotate(matrices, transform);
        scale(matrices, transform);
    }

    /**
     * Entity model space: mirrored and upside down, so right/up/forward all flip sign.
     * Rotations keep the same sense as the first person ones so both pages feel alike.
     */
    public static void applyThirdPerson(MatrixStack matrices, Transform transform) {
        matrices.translate(-transform.x / 16.0F, -transform.y / 16.0F, -transform.z / 16.0F);
        rotate(matrices, transform);
        scale(matrices, transform);
    }

    private static void rotate(MatrixStack matrices, Transform transform) {
        if (transform.yaw != 0.0F) {
            matrices.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(transform.yaw));
        }
        if (transform.pitch != 0.0F) {
            matrices.multiply(RotationAxis.POSITIVE_X.rotationDegrees(transform.pitch));
        }
        if (transform.roll != 0.0F) {
            matrices.multiply(RotationAxis.POSITIVE_Z.rotationDegrees(transform.roll));
        }
    }

    private static void scale(MatrixStack matrices, Transform transform) {
        if (transform.scale != 1.0F) {
            matrices.scale(transform.scale, transform.scale, transform.scale);
        }
    }
}
