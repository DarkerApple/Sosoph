package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** One of the tabs across the top of the menu. */
public class TabButton extends Row {
    private final BooleanSupplier selected;
    private final Runnable onPress;

    public TabButton(int width, Component label, BooleanSupplier selected, Runnable onPress) {
        super(width, 16, label);
        this.selected = selected;
        this.onPress = onPress;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        boolean active = this.selected.getAsBoolean();
        boolean hovered = this.isOver(mouseX, mouseY);

        graphics.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                active ? Theme.ACCENT_FILL : (hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG));
        if (active) {
            graphics.fill(this.getX(), this.getY() + this.getHeight() - 2, this.getX() + this.getWidth(),
                    this.getY() + this.getHeight(), Theme.ACCENT);
        }

        String label = Compat.trim(this.font, this.getMessage().getString(), this.getWidth() - 6);
        graphics.centeredText(this.font, label, this.getX() + this.getWidth() / 2, this.getY() + 4,
                active ? Theme.TEXT : Theme.TEXT_DIM);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        if (!Compat.isLeftClick(click) || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        this.onPress.run();
        this.playClick();
        return true;
    }
}
