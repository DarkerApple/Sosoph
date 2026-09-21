package dev.sosoph.viewmodel.gui.widget;

import java.util.function.Supplier;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Label on the left, current choice on the right. Left click goes forward, right click back. */
public class CycleRow extends Row {
    private final Supplier<Component> value;
    private final Runnable forward;
    private final Runnable backward;

    public CycleRow(int width, Component label, Supplier<Component> value, Runnable forward, Runnable backward) {
        super(width, HEIGHT, label);
        this.value = value;
        this.forward = forward;
        this.backward = backward;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        this.drawBackground(graphics, this.isOver(mouseX, mouseY));
        graphics.text(this.font, this.getMessage(), this.getX() + 5, this.textY(), Theme.TEXT);
        Component current = this.value.get();
        graphics.text(this.font, current, this.getX() + this.getWidth() - 5 - this.font.width(current),
                this.textY(), Theme.ACCENT);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        if (!this.active || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        if (Compat.isLeftClick(click)) {
            this.forward.run();
        } else if (Compat.isRightClick(click)) {
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
