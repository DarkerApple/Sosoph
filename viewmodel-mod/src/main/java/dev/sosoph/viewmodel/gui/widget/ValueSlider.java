package dev.sosoph.viewmodel.gui.widget;

import java.util.Locale;
import java.util.function.DoubleConsumer;
import java.util.function.DoubleSupplier;

import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import net.minecraft.util.math.MathHelper;
import org.lwjgl.glfw.GLFW;

/**
 * A full width slider row that always lands on a step.
 *
 * <p>Drag it, scroll it, or nudge it with the arrow keys. Holding shift switches to
 * the fine step and right clicking puts the value back to its default.
 */
public class ValueSlider extends Row {
    private static final String DEGREES = "\u00B0";

    private final double min;
    private final double max;
    private final double step;
    private final double fineStep;
    private final double defaultValue;
    private final DoubleSupplier getter;
    private final DoubleConsumer setter;
    private final String suffix;
    private final int decimals;

    private boolean dragging;

    public ValueSlider(int width, Text label, double min, double max, double step, double fineStep,
                       double defaultValue, String suffix, int decimals,
                       DoubleSupplier getter, DoubleConsumer setter) {
        super(width, HEIGHT, label);
        this.min = min;
        this.max = max;
        this.step = step;
        this.fineStep = fineStep;
        this.defaultValue = defaultValue;
        this.suffix = suffix;
        this.decimals = decimals;
        this.getter = getter;
        this.setter = setter;
    }

    /** -32..32 pixel offset slider. */
    public static ValueSlider position(int width, Text label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.POS_MIN, Transform.Limits.POS_MAX,
                Transform.Limits.POS_STEP, Transform.Limits.POS_FINE_STEP, 0.0, "", 2, getter, setter);
    }

    /** -180..180 degree slider. */
    public static ValueSlider rotation(int width, Text label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.ROT_MIN, Transform.Limits.ROT_MAX,
                Transform.Limits.ROT_STEP, Transform.Limits.ROT_FINE_STEP, 0.0, DEGREES, 1, getter, setter);
    }

    /** 0.1..3.0 scale slider. */
    public static ValueSlider scale(int width, Text label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.SCALE_MIN, Transform.Limits.SCALE_MAX,
                Transform.Limits.SCALE_STEP, Transform.Limits.SCALE_FINE_STEP, 1.0, "x", 2, getter, setter);
    }

    public double getValue() {
        return this.getter.getAsDouble();
    }

    private void setValue(double raw, double quantum) {
        double snapped = this.min + Math.round((raw - this.min) / quantum) * quantum;
        snapped = MathHelper.clamp(snapped, this.min, this.max);
        // Kill the floating point dust that repeated stepping leaves behind.
        snapped = Math.round(snapped * 1000.0) / 1000.0;
        if (snapped != this.getValue()) {
            this.setter.accept(snapped);
        }
    }

    private double activeStep() {
        return Screen.hasShiftDown() ? this.fineStep : this.step;
    }

    private void nudge(int direction) {
        this.setValue(this.getValue() + direction * this.activeStep(), this.activeStep());
    }

    private void setFromMouse(double mouseX) {
        double fraction = MathHelper.clamp((mouseX - this.getX()) / (double) this.getWidth(), 0.0, 1.0);
        this.setValue(this.min + fraction * (this.max - this.min), this.activeStep());
    }

    private String formatValue() {
        return String.format(Locale.ROOT, "%." + this.decimals + "f%s", this.getValue(), this.suffix);
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        this.drawBackground(context, hovered || this.dragging);

        double fraction = (this.getValue() - this.min) / (this.max - this.min);
        int filled = (int) Math.round(MathHelper.clamp(fraction, 0.0, 1.0) * this.getWidth());
        if (filled > 0) {
            context.fill(this.getX(), this.getY(), this.getX() + filled, this.getY() + this.getHeight(),
                    Theme.ACCENT_FILL);
        }
        if (filled > 0 && filled < this.getWidth()) {
            context.fill(this.getX() + filled - 1, this.getY(), this.getX() + filled + 1,
                    this.getY() + this.getHeight(), Theme.ACCENT);
        }

        context.drawTextWithShadow(this.textRenderer, this.getMessage(), this.getX() + 5, this.textY(), Theme.TEXT);

        String value = this.formatValue();
        context.drawTextWithShadow(this.textRenderer, value,
                this.getX() + this.getWidth() - 5 - this.textRenderer.getWidth(value), this.textY(),
                this.getValue() == this.defaultValue ? Theme.TEXT_DIM : Theme.ACCENT);

        if (this.isFocused()) {
            context.drawBorder(this.getX(), this.getY(), this.getWidth(), this.getHeight(), Theme.ACCENT);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.active || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
            this.setValue(this.defaultValue, this.fineStep);
            this.playClick();
            return true;
        }
        if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
            this.dragging = true;
            this.setFromMouse(mouseX);
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
        if (this.dragging && button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
            this.setFromMouse(mouseX);
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        boolean wasDragging = this.dragging;
        this.dragging = false;
        return wasDragging;
    }

    /**
     * Only claims the wheel while shift or control is held, so a plain wheel still
     * scrolls the list underneath instead of fighting it.
     */
    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        boolean fine = Screen.hasShiftDown();
        boolean coarse = Screen.hasControlDown();
        if (!this.active || (!fine && !coarse) || !this.isOver(mouseX, mouseY) || verticalAmount == 0.0) {
            return false;
        }
        double quantum = fine ? this.fineStep : this.step;
        this.setValue(this.getValue() + (verticalAmount > 0.0 ? quantum : -quantum), quantum);
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (!this.active || !this.isFocused()) {
            return false;
        }
        switch (keyCode) {
            case GLFW.GLFW_KEY_LEFT -> {
                this.nudge(-1);
                return true;
            }
            case GLFW.GLFW_KEY_RIGHT -> {
                this.nudge(1);
                return true;
            }
            case GLFW.GLFW_KEY_BACKSPACE, GLFW.GLFW_KEY_DELETE -> {
                this.setValue(this.defaultValue, this.fineStep);
                return true;
            }
            default -> {
                return false;
            }
        }
    }
}
