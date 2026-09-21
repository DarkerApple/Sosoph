package dev.sosoph.viewmodel.gui.widget;

import java.util.Locale;
import java.util.function.DoubleConsumer;
import java.util.function.DoubleSupplier;

import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

/**
 * A full width slider row that always lands on a step.
 *
 * <p>Drag it, nudge it with the arrow keys, or hold shift and scroll. Holding shift
 * switches to the fine step and right clicking puts the value back to its default.
 */
public class ValueSlider extends Row {
    private static final String DEGREES = "°";

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

    public ValueSlider(int width, Component label, double min, double max, double step, double fineStep,
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
    public static ValueSlider position(int width, Component label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.POS_MIN, Transform.Limits.POS_MAX,
                Transform.Limits.POS_STEP, Transform.Limits.POS_FINE_STEP, 0.0, "", 2, getter, setter);
    }

    /** -180..180 degree slider. */
    public static ValueSlider rotation(int width, Component label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.ROT_MIN, Transform.Limits.ROT_MAX,
                Transform.Limits.ROT_STEP, Transform.Limits.ROT_FINE_STEP, 0.0, DEGREES, 1, getter, setter);
    }

    /** 0.1..3.0 scale slider. */
    public static ValueSlider scale(int width, Component label, DoubleSupplier getter, DoubleConsumer setter) {
        return new ValueSlider(width, label, Transform.Limits.SCALE_MIN, Transform.Limits.SCALE_MAX,
                Transform.Limits.SCALE_STEP, Transform.Limits.SCALE_FINE_STEP, 1.0, "x", 2, getter, setter);
    }

    public double getValue() {
        return this.getter.getAsDouble();
    }

    private void setValue(double raw, double quantum) {
        double snapped = this.min + Math.round((raw - this.min) / quantum) * quantum;
        snapped = Mth.clamp(snapped, this.min, this.max);
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
        double fraction = Mth.clamp((mouseX - this.getX()) / (double) this.getWidth(), 0.0, 1.0);
        this.setValue(this.min + fraction * (this.max - this.min), this.activeStep());
    }

    private String formatValue() {
        return String.format(Locale.ROOT, "%." + this.decimals + "f%s", this.getValue(), this.suffix);
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        this.drawBackground(graphics, hovered || this.dragging);

        double fraction = (this.getValue() - this.min) / (this.max - this.min);
        int filled = (int) Math.round(Mth.clamp(fraction, 0.0, 1.0) * this.getWidth());
        if (filled > 0) {
            graphics.fill(this.getX(), this.getY(), this.getX() + filled, this.getY() + this.getHeight(),
                    Theme.ACCENT_FILL);
        }
        if (filled > 0 && filled < this.getWidth()) {
            graphics.fill(this.getX() + filled - 1, this.getY(), this.getX() + filled + 1,
                    this.getY() + this.getHeight(), Theme.ACCENT);
        }

        graphics.text(this.font, this.getMessage(), this.getX() + 5, this.textY(), Theme.TEXT);

        String value = this.formatValue();
        graphics.text(this.font, value, this.getX() + this.getWidth() - 5 - this.font.width(value), this.textY(),
                this.getValue() == this.defaultValue ? Theme.TEXT_DIM : Theme.ACCENT);

        if (this.isFocused()) {
            this.drawBorder(graphics, Theme.ACCENT);
        }
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        this.dragging = false;
        if (!this.active || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        if (Compat.isRightClick(click)) {
            this.setValue(this.defaultValue, this.fineStep);
            this.playClick();
            return true;
        }
        if (Compat.isLeftClick(click)) {
            this.dragging = true;
            this.setFromMouse(Compat.mouseX(click));
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent click, double deltaX, double deltaY) {
        if (this.dragging && Compat.isLeftClick(click)) {
            this.setFromMouse(Compat.mouseX(click));
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent click) {
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
    public boolean keyPressed(KeyEvent input) {
        if (!this.active || !this.isFocused()) {
            return false;
        }
        if (input.isLeft()) {
            this.nudge(-1);
            return true;
        }
        if (input.isRight()) {
            this.nudge(1);
            return true;
        }
        return false;
    }
}
