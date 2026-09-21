package dev.sosoph.viewmodel.gui.widget;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Label on the left, ON/OFF pill on the right. */
public class ToggleRow extends Row {
    private static final Text ON = Text.translatable("viewmodel.state.on");
    private static final Text OFF = Text.translatable("viewmodel.state.off");

    private final BooleanSupplier getter;
    private final Consumer<Boolean> setter;

    public ToggleRow(int width, Text label, BooleanSupplier getter, Consumer<Boolean> setter) {
        super(width, HEIGHT, label);
        this.getter = getter;
        this.setter = setter;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        boolean value = this.getter.getAsBoolean();
        this.drawBackground(context, this.isOver(mouseX, mouseY));
        context.drawTextWithShadow(this.textRenderer, this.getMessage(), this.getX() + 5, this.textY(),
                value ? Theme.TEXT : Theme.TEXT_DIM);
        this.drawPill(context, value ? ON : OFF, value ? Theme.ON : Theme.TEXT_OFF,
                value ? 0x336BD97F : 0x33000000);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.active || button != GLFW.GLFW_MOUSE_BUTTON_LEFT || !this.isOver(mouseX, mouseY)) {
            return false;
        }
        this.setter.accept(!this.getter.getAsBoolean());
        this.playClick();
        return true;
    }
}
