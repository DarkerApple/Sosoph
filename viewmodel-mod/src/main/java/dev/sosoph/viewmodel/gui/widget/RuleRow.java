package dev.sosoph.viewmodel.gui.widget;

import java.util.function.Supplier;

import dev.sosoph.viewmodel.config.ThirdPersonRule;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/** One entry in the third person rule list. */
public class RuleRow extends Row {
    private final ThirdPersonRule rule;
    private final ItemStack stack;
    private final Supplier<ThirdPersonRule> selection;
    private final Runnable onSelect;
    private final Runnable onToggle;

    public RuleRow(int width, ThirdPersonRule rule, Supplier<ThirdPersonRule> selection, Runnable onSelect,
                   Runnable onToggle) {
        super(width, 20, Component.literal(rule.item));
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
    protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        boolean hovered = this.isOver(mouseX, mouseY);
        boolean selected = this.selection.get() == this.rule;

        graphics.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                selected ? Theme.ACCENT_FILL : (hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG));
        if (selected) {
            graphics.fill(this.getX(), this.getY(), this.getX() + 2, this.getY() + this.getHeight(), Theme.ACCENT);
        }

        if (!this.stack.isEmpty()) {
            Compat.item(graphics, this.stack, this.getX() + 4, this.getY() + 2);
        }

        String name = this.stack.isEmpty() ? this.rule.item : this.stack.getHoverName().getString();
        name = Compat.trimWithEllipsis(this.font, name, this.getWidth() - 26 - 22);
        graphics.text(this.font, name, this.getX() + 24, this.getY() + 6,
                this.rule.enabled ? Theme.TEXT : Theme.TEXT_OFF);

        Component state = Component.translatable(this.rule.enabled ? "viewmodel.state.on" : "viewmodel.state.off");
        graphics.text(this.font, state, this.getX() + this.getWidth() - 4 - this.font.width(state),
                this.getY() + 6, this.rule.enabled ? Theme.ON : Theme.TEXT_OFF);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        if (!this.active || !this.isOver(Compat.mouseX(click), Compat.mouseY(click))) {
            return false;
        }
        if (Compat.isLeftClick(click)) {
            this.onSelect.run();
        } else if (Compat.isRightClick(click)) {
            this.onToggle.run();
        } else {
            return false;
        }
        this.playClick();
        return true;
    }
}
