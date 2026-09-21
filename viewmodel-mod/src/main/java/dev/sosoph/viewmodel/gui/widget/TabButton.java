package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** One of the tabs across the top of the menu. */
public class TabButton extends Row {
    private final BooleanSupplier selected;
    private final Runnable onPress;

    public TabButton(int width, Text label, BooleanSupplier selected, Runnable onPress) {
        super(width, 16, label);
        this.selected = selected;
        this.onPress = onPress;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean active = this.selected.getAsBoolean();
        boolean hovered = this.isOver(mouseX, mouseY);

        context.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                active ? Theme.ACCENT_FILL : (hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG));
        if (active) {
            context.fill(this.getX(), this.getY() + this.getHeight() - 2, this.getX() + this.getWidth(),
                    this.getY() + this.getHeight(), Theme.ACCENT);
        }

        String label = this.getMessage().getString();
        if (this.textRenderer.getWidth(label) > this.getWidth() - 6) {
            label = this.textRenderer.trimToWidth(label, this.getWidth() - 6);
        }
        context.drawCenteredTextWithShadow(this.textRenderer, label, this.getX() + this.getWidth() / 2,
                this.getY() + 4, active ? Theme.TEXT : Theme.TEXT_DIM);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button != GLFW.GLFW_MOUSE_BUTTON_LEFT || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        this.onPress.run();
        this.playClick();
        return true;
    }
}
