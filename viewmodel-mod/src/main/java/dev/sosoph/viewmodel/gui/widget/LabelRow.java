package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

/** A non interactive section title. */
public class LabelRow extends Row {
    private final boolean dim;

    public LabelRow(int width, Text title) {
        this(width, title, false);
    }

    public LabelRow(int width, Text title, boolean dim) {
        super(width, 14, title);
        this.dim = dim;
        this.active = false;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        context.drawTextWithShadow(this.textRenderer, this.getMessage(), this.getX(), this.getY() + 4,
                this.dim ? Theme.TEXT_DIM : Theme.ACCENT);
        if (!this.dim) {
            context.fill(this.getX(), this.getY() + 13, this.getX() + this.getWidth(), this.getY() + 14, Theme.BORDER);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        return false;
    }
}
