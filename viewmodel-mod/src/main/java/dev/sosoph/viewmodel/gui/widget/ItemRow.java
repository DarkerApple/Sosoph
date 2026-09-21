package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Item icon, name, and an optional state pill. Used by the blacklist and the item picker. */
public class ItemRow extends Row {
    private final ItemStack stack;
    private final String id;
    private final BooleanSupplier state;
    private final Text onLabel;
    private final Text offLabel;
    private final Runnable onPress;

    public ItemRow(int width, Item item, String id, BooleanSupplier state, Text onLabel, Text offLabel,
                   Runnable onPress) {
        super(width, 20, Text.literal(id));
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
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        boolean on = this.state != null && this.state.getAsBoolean();
        this.drawBackground(context, hovered);

        context.drawItem(this.stack, this.getX() + 2, this.getY() + 2);

        int pillWidth = this.state == null ? 0
                : this.textRenderer.getWidth(on ? this.onLabel : this.offLabel) + 12;
        int nameWidth = this.getWidth() - 22 - pillWidth - 6;
        String name = this.stack.getName().getString();
        if (this.textRenderer.getWidth(name) > nameWidth) {
            name = this.textRenderer.trimToWidth(name, Math.max(0, nameWidth - 6)) + "...";
        }
        context.drawTextWithShadow(this.textRenderer, name, this.getX() + 22, this.textY(),
                this.state == null || on ? Theme.TEXT : Theme.TEXT_DIM);

        if (this.state != null) {
            this.drawPill(context, on ? this.onLabel : this.offLabel, on ? Theme.DANGER : Theme.TEXT_OFF,
                    on ? 0x33E06A6A : 0x33000000);
        }

        if (hovered) {
            context.drawBorder(this.getX(), this.getY(), this.getWidth(), this.getHeight(), Theme.BORDER);
        }
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
