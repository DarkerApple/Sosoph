package dev.sosoph.viewmodel.gui.widget;

import java.util.function.Supplier;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Label on the left, current choice on the right. Left click goes forward, right click back. */
public class CycleRow extends Row {
    private final Supplier<Text> value;
    private final Runnable forward;
    private final Runnable backward;

    public CycleRow(int width, Text label, Supplier<Text> value, Runnable forward, Runnable backward) {
        super(width, HEIGHT, label);
        this.value = value;
        this.forward = forward;
        this.backward = backward;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        this.drawBackground(context, this.isOver(mouseX, mouseY));
        context.drawTextWithShadow(this.textRenderer, this.getMessage(), this.getX() + 5, this.textY(), Theme.TEXT);
        Text current = this.value.get();
        context.drawTextWithShadow(this.textRenderer, current,
                this.getX() + this.getWidth() - 5 - this.textRenderer.getWidth(current), this.textY(), Theme.ACCENT);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.active || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
            this.forward.run();
        } else if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
            this.backward.run();
        } else {
            return false;
        }
        this.playClick();
        return true;
    }

    /** Same rule as the sliders: a bare wheel belongs to the list. */
    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        if (!this.active || !(Screen.hasShiftDown() || Screen.hasControlDown())
                || !this.isOver(mouseX, mouseY) || verticalAmount == 0.0) {
            return false;
        }
        if (verticalAmount > 0.0) {
            this.forward.run();
        } else {
            this.backward.run();
        }
        return true;
    }
}
