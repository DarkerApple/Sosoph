package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/** Item icon, name, and an optional state pill. Used by the blacklist and the item picker. */
public class ItemRow extends Row {
    private final ItemStack stack;
    private final String id;
    private final BooleanSupplier state;
    private final Component onLabel;
    private final Component offLabel;
    private final Runnable onPress;

    public ItemRow(int width, Item item, String id, BooleanSupplier state, Component onLabel, Component offLabel,
                   Runnable onPress) {
        super(width, 20, Component.literal(id));
        this.stack = new ItemStack(item);
        this.id = id;
        this.state = state;
        this.onLabel = onLabel;
        this.offLabel = offLabel;
        this.onPress = onPress;
    }

    public String getId() {
        return this.id;
    }

    @Override
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        boolean on = this.state != null && this.state.getAsBoolean();
        this.drawBackground(graphics, hovered);

        Compat.item(graphics, this.stack, this.getX() + 2, this.getY() + 2);

        int pillWidth = this.state == null ? 0 : this.font.width(on ? this.onLabel : this.offLabel) + 12;
        int nameWidth = this.getWidth() - 22 - pillWidth - 6;
        String name = Compat.trimWithEllipsis(this.font, this.stack.getHoverName().getString(), nameWidth);
        graphics.text(this.font, name, this.getX() + 22, this.textY(),
                this.state == null || on ? Theme.TEXT : Theme.TEXT_DIM);

        if (this.state != null) {
            this.drawPill(graphics, on ? this.onLabel : this.offLabel, on ? Theme.DANGER : Theme.TEXT_OFF,
                    on ? 0x33E06A6A : 0x33000000);
        }

        if (hovered) {
            this.drawBorder(graphics, Theme.BORDER);
        }
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
