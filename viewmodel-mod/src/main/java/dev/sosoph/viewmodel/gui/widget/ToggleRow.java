package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Label on the left, ON/OFF pill on the right. */
public class ToggleRow extends Row {
    private static final Component ON = Component.translatable("viewmodel.state.on");
    private static final Component OFF = Component.translatable("viewmodel.state.off");

    private final BooleanSupplier getter;
    private final Consumer<Boolean> setter;

    public ToggleRow(int width, Component label, BooleanSupplier getter, Consumer<Boolean> setter) {
        super(width, HEIGHT, label);
        this.getter = getter;
        this.setter = setter;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        boolean value = this.getter.getAsBoolean();
        this.drawBackground(graphics, this.isOver(mouseX, mouseY));
        graphics.text(this.font, this.getMessage(), this.getX() + 5, this.textY(),
                value ? Theme.TEXT : Theme.TEXT_DIM);
        this.drawPill(graphics, value ? ON : OFF, value ? Theme.ON : Theme.TEXT_OFF,
                value ? 0x336BD97F : 0x33000000);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        if (!this.active || !Compat.isLeftClick(click)
                || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        this.setter.accept(!this.getter.getAsBoolean());
        this.playClick();
        return true;
    }
}
