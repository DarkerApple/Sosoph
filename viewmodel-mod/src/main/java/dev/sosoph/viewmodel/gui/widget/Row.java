package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;

/** Shared look and helpers for every row in the menu. */
public abstract class Row extends ClickableWidget {
    public static final int HEIGHT = 18;

    protected final TextRenderer textRenderer = MinecraftClient.getInstance().textRenderer;

    protected Row(int width, int height, Text message) {
        super(0, 0, width, height, message);
    }

    protected boolean isOver(double mouseX, double mouseY) {
        return this.visible
                && mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
    }

    protected void drawBackground(DrawContext context, boolean hovered) {
        context.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG);
    }

    protected int textY() {
        return this.getY() + (this.getHeight() - this.textRenderer.fontHeight) / 2 + 1;
    }

    protected void playClick() {
        this.playDownSound(MinecraftClient.getInstance().getSoundManager());
    }

    /** Draws a small "ON"/"OFF" style pill on the right hand side of the row. */
    protected void drawPill(DrawContext context, Text label, int color, int background) {
        int labelWidth = this.textRenderer.getWidth(label);
        int right = this.getX() + this.getWidth() - 4;
        int left = right - labelWidth - 8;
        context.fill(left, this.getY() + 3, right, this.getY() + this.getHeight() - 3, background);
        context.drawTextWithShadow(this.textRenderer, label, left + 4, this.textY(), color);
    }

    @Override
    protected void appendClickableNarrations(NarrationMessageBuilder builder) {
        this.appendDefaultNarrations(builder);
    }
}
