package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** A flat button that fills the width of the panel. */
public class ActionRow extends Row {
    private final Runnable onPress;
    private final int color;

    public ActionRow(int width, Text label, Runnable onPress) {
        this(width, label, Theme.TEXT, onPress);
    }

    public ActionRow(int width, Text label, int color, Runnable onPress) {
        super(width, HEIGHT, label);
        this.onPress = onPress;
        this.color = color;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        this.drawBackground(context, hovered);
        context.drawCenteredTextWithShadow(this.textRenderer, this.getMessage(),
                this.getX() + this.getWidth() / 2, this.textY(), this.active ? this.color : Theme.TEXT_OFF);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.active || button != GLFW.GLFW_MOUSE_BUTTON_LEFT || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        this.onPress.run();
        this.playClick();
        return true;
    }
}
