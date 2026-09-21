package dev.sosoph.viewmodel.gui.page;

import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.Theme;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.LabelRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import dev.sosoph.viewmodel.gui.widget.ToggleRow;
import dev.sosoph.viewmodel.gui.widget.ValueSlider;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;

/** Swing timing and swing travel, with a preview you can trigger from the menu. */
public class AnimationPage extends ConfigPage {
    private boolean autoSwing;

    public AnimationPage(ViewModelScreen screen) {
        super(screen);
    }

    @Override
    public Component getTitle() {
        return Component.translatable("viewmodel.tab.animation");
    }

    @Override
    public void init(int x, int y, int width, int height) {
        ScrollPanel panel = new ScrollPanel(x, y, width, height);
        int rowWidth = panel.rowWidth();

        panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.section.swing")));
        panel.add(new ValueSlider(rowWidth, Component.translatable("viewmodel.option.swing_speed"),
                ViewModelConfig.SWING_SPEED_MIN, ViewModelConfig.SWING_SPEED_MAX, 0.05, 0.01, 1.0, "x", 2,
                () -> config().swingSpeed, value -> config().swingSpeed = (float) value));
        panel.add(new ValueSlider(rowWidth, Component.translatable("viewmodel.option.swing_amount"),
                ViewModelConfig.SWING_AMOUNT_MIN, ViewModelConfig.SWING_AMOUNT_MAX, 0.05, 0.01, 1.0, "x", 2,
                () -> config().swingAmount, value -> config().swingAmount = (float) value));
        panel.addSpacer(6);

        panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.section.preview")));
        panel.add(new ActionRow(rowWidth, Component.translatable("viewmodel.button.swing_once"), this::swingOnce));
        panel.add(new ToggleRow(rowWidth, Component.translatable("viewmodel.option.auto_swing"),
                () -> this.autoSwing, value -> this.autoSwing = value));

        this.screen.addPageWidget(panel);
    }

    private void swingOnce() {
        LocalPlayer player = this.minecraft.player;
        if (player != null) {
            // Local only: no packet, so the server never sees these preview swings.
            player.swing(InteractionHand.MAIN_HAND, true);
        }
    }

    @Override
    public void tick() {
        LocalPlayer player = this.minecraft.player;
        if (this.autoSwing && player != null && player.getAttackAnim(1.0F) <= 0.0F) {
            this.swingOnce();
        }
    }

    @Override
    public void extract(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        Component note = this.minecraft.player == null
                ? Component.translatable("viewmodel.preview.needs_world")
                : Component.translatable("viewmodel.preview.live_hand");
        int x = this.screen.width - 8 - this.font.width(note);
        graphics.text(this.font, note, x, 10,
                this.minecraft.player == null ? Theme.TEXT_OFF : Theme.TEXT_DIM);
    }

    @Override
    public Component getHint() {
        return Component.translatable("viewmodel.hint.animation");
    }

    @Override
    public void resetPage() {
        config().swingSpeed = 1.0F;
        config().swingAmount = 1.0F;
    }
}
