package dev.sosoph.viewmodel.config;

/**
 * A position / rotation / scale offset.
 *
 * <p>Axes are always expressed the way a player thinks about them, never the way the
 * renderer does: {@code x} is right, {@code y} is up, {@code z} is forward, all in
 * pixels (1/16 of a block). Rotations are degrees.
 */
public class Transform {
    public float x = 0.0F;
    public float y = 0.0F;
    public float z = 0.0F;
    public float pitch = 0.0F;
    public float yaw = 0.0F;
    public float roll = 0.0F;
    public float scale = 1.0F;

    public Transform() {
    }

    public Transform(float x, float y, float z, float pitch, float yaw, float roll, float scale) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.pitch = pitch;
        this.yaw = yaw;
        this.roll = roll;
        this.scale = scale;
    }

    /** True when this transform would not move the item at all, so rendering can skip it. */
    public boolean isIdentity() {
        return this.x == 0.0F && this.y == 0.0F && this.z == 0.0F
                && this.pitch == 0.0F && this.yaw == 0.0F && this.roll == 0.0F
                && this.scale == 1.0F;
    }

    public void reset() {
        this.x = 0.0F;
        this.y = 0.0F;
        this.z = 0.0F;
        this.pitch = 0.0F;
        this.yaw = 0.0F;
        this.roll = 0.0F;
        this.scale = 1.0F;
    }

    public void copyFrom(Transform other) {
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
        this.pitch = other.pitch;
        this.yaw = other.yaw;
        this.roll = other.roll;
        this.scale = other.scale;
    }

    public Transform copy() {
        return new Transform(this.x, this.y, this.z, this.pitch, this.yaw, this.roll, this.scale);
    }

    void validate() {
        this.x = clamp(this.x, Limits.POS_MIN, Limits.POS_MAX);
        this.y = clamp(this.y, Limits.POS_MIN, Limits.POS_MAX);
        this.z = clamp(this.z, Limits.POS_MIN, Limits.POS_MAX);
        this.pitch = clamp(this.pitch, Limits.ROT_MIN, Limits.ROT_MAX);
        this.yaw = clamp(this.yaw, Limits.ROT_MIN, Limits.ROT_MAX);
        this.roll = clamp(this.roll, Limits.ROT_MIN, Limits.ROT_MAX);
        this.scale = clamp(this.scale, Limits.SCALE_MIN, Limits.SCALE_MAX);
    }

    private static float clamp(float value, float min, float max) {
        if (Float.isNaN(value)) {
            return min < 0.0F ? 0.0F : min;
        }
        return Math.max(min, Math.min(max, value));
    }

    /** Slider bounds, shared by the config validator and the GUI. */
    public static final class Limits {
        public static final float POS_MIN = -32.0F;
        public static final float POS_MAX = 32.0F;
        public static final float POS_STEP = 0.25F;
        public static final float POS_FINE_STEP = 0.05F;

        public static final float ROT_MIN = -180.0F;
        public static final float ROT_MAX = 180.0F;
        public static final float ROT_STEP = 1.0F;
        public static final float ROT_FINE_STEP = 0.1F;

        public static final float SCALE_MIN = 0.1F;
        public static final float SCALE_MAX = 3.0F;
        public static final float SCALE_STEP = 0.05F;
        public static final float SCALE_FINE_STEP = 0.01F;

        private Limits() {
        }
    }
}
