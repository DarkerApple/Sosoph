package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** A flat button that fills the width of the panel. */
public class ActionRow extends Row {
    private final Runnable onPress;
    private final int color;

    public ActionRow(int width, Component label, Runnable onPress) {
        this(width, label, Theme.TEXT, onPress);
    }

    public ActionRow(int width, Component label, int color, Runnable onPress) {
        super(width, HEIGHT, label);
        this.onPress = onPress;
        this.color = color;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        this.drawBackground(graphics, this.isOver(mouseX, mouseY));
        graphics.centeredText(this.font, this.getMessage(), this.getX() + this.getWidth() / 2, this.textY(),
                this.active ? this.color : Theme.TEXT_OFF);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        if (!this.active || !Compat.isLeftClick(click)
                || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        this.onPress.run();
        this.playClick();
        return true;
    }
}
