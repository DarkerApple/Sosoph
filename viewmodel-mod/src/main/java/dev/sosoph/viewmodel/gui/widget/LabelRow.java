package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** A non interactive section title. */
public class LabelRow extends Row {
    private final boolean dim;

    public LabelRow(int width, Component title) {
        this(width, title, false);
    }

    public LabelRow(int width, Component title, boolean dim) {
        super(width, 14, title);
        this.dim = dim;
        this.active = false;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        graphics.text(this.font, this.getMessage(), this.getX(), this.getY() + 4,
                this.dim ? Theme.TEXT_DIM : Theme.ACCENT);
        if (!this.dim) {
            graphics.fill(this.getX(), this.getY() + 13, this.getX() + this.getWidth(), this.getY() + 14,
                    Theme.BORDER);
        }
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        return false;
    }
}
