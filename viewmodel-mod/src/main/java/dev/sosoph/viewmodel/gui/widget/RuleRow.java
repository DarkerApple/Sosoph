package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.config.ThirdPersonRule;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** One entry in the third person rule list. */
public class RuleRow extends Row {
    private final ThirdPersonRule rule;
    private final ItemStack stack;
    private final Runnable onSelect;
    private final Runnable onToggle;
    private final java.util.function.Supplier<ThirdPersonRule> selection;

    public RuleRow(int width, ThirdPersonRule rule, java.util.function.Supplier<ThirdPersonRule> selection,
                   Runnable onSelect, Runnable onToggle) {
        super(width, 20, Text.literal(rule.item));
        this.rule = rule;
        Item item = ViewModelConfig.itemOf(rule.item);
        this.stack = item == null ? ItemStack.EMPTY : new ItemStack(item);
        this.selection = selection;
        this.onSelect = onSelect;
        this.onToggle = onToggle;
    }

    public ThirdPersonRule getRule() {
        return this.rule;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        boolean selected = this.selection.get() == this.rule;

        context.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                selected ? Theme.ACCENT_FILL : (hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG));
        if (selected) {
            context.fill(this.getX(), this.getY(), this.getX() + 2, this.getY() + this.getHeight(), Theme.ACCENT);
        }

        if (!this.stack.isEmpty()) {
            context.drawItem(this.stack, this.getX() + 4, this.getY() + 2);
        }

        String name = this.stack.isEmpty() ? this.rule.item : this.stack.getName().getString();
        int available = this.getWidth() - 26 - 22;
        if (this.textRenderer.getWidth(name) > available) {
            name = this.textRenderer.trimToWidth(name, Math.max(0, available - 6)) + "...";
        }
        context.drawTextWithShadow(this.textRenderer, name, this.getX() + 24, this.getY() + 6,
                this.rule.enabled ? Theme.TEXT : Theme.TEXT_OFF);

        Text state = Text.translatable(this.rule.enabled ? "viewmodel.state.on" : "viewmodel.state.off");
        context.drawTextWithShadow(this.textRenderer, state,
                this.getX() + this.getWidth() - 4 - this.textRenderer.getWidth(state), this.getY() + 6,
                this.rule.enabled ? Theme.ON : Theme.TEXT_OFF);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.active || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
            this.onSelect.run();
        } else if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
            this.onToggle.run();
        } else {
            return false;
        }
        this.playClick();
        return true;
    }
}
