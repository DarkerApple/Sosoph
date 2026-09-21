package dev.sosoph.viewmodel.gui.page;

import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.gui.Theme;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.LabelRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import dev.sosoph.viewmodel.gui.widget.ValueSlider;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

/** Main hand and off hand view model offsets. */
public class FirstPersonPage extends ConfigPage {
    public FirstPersonPage(ViewModelScreen screen) {
        super(screen);
    }

    @Override
    public Text getTitle() {
        return Text.translatable("viewmodel.tab.first_person");
    }

    @Override
    public void init(int x, int y, int width, int height) {
        ScrollPanel panel = new ScrollPanel(x, y, width, height);
        int rowWidth = panel.rowWidth();

        panel.add(new LabelRow(rowWidth, Text.translatable("viewmodel.section.main_hand")));
        addTransformRows(panel, rowWidth, true);
        panel.addSpacer(6);

        panel.add(new LabelRow(rowWidth, Text.translatable("viewmodel.section.off_hand")));
        addTransformRows(panel, rowWidth, false);
        panel.addSpacer(6);

        panel.add(new LabelRow(rowWidth, Text.translatable("viewmodel.section.tools")));
        panel.add(new ActionRow(rowWidth, Text.translatable("viewmodel.button.copy_to_off_hand"), () -> {
            config().offHand.copyFrom(config().mainHand);
        }));
        panel.add(new ActionRow(rowWidth, Text.translatable("viewmodel.button.mirror_to_off_hand"), () -> {
            Transform source = config().mainHand;
            Transform target = config().offHand;
            target.copyFrom(source);
            target.x = -source.x;
            target.yaw = -source.yaw;
            target.roll = -source.roll;
        }));

        this.screen.addPageWidget(panel);
    }

    private void addTransformRows(ScrollPanel panel, int rowWidth, boolean mainHand) {
        panel.add(ValueSlider.position(rowWidth, Text.translatable("viewmodel.option.x"),
                () -> config().handTransform(mainHand).x, value -> config().handTransform(mainHand).x = (float) value));
        panel.add(ValueSlider.position(rowWidth, Text.translatable("viewmodel.option.y"),
                () -> config().handTransform(mainHand).y, value -> config().handTransform(mainHand).y = (float) value));
        panel.add(ValueSlider.position(rowWidth, Text.translatable("viewmodel.option.z"),
                () -> config().handTransform(mainHand).z, value -> config().handTransform(mainHand).z = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Text.translatable("viewmodel.option.pitch"),
                () -> config().handTransform(mainHand).pitch,
                value -> config().handTransform(mainHand).pitch = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Text.translatable("viewmodel.option.yaw"),
                () -> config().handTransform(mainHand).yaw,
                value -> config().handTransform(mainHand).yaw = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Text.translatable("viewmodel.option.roll"),
                () -> config().handTransform(mainHand).roll,
                value -> config().handTransform(mainHand).roll = (float) value));
        panel.add(ValueSlider.scale(rowWidth, Text.translatable("viewmodel.option.scale"),
                () -> config().handTransform(mainHand).scale,
                value -> config().handTransform(mainHand).scale = (float) value));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        Text note = this.client.world == null
                ? Text.translatable("viewmodel.preview.needs_world")
                : Text.translatable("viewmodel.preview.live_hand");
        int x = this.screen.width - 8 - this.textRenderer.getWidth(note);
        context.drawTextWithShadow(this.textRenderer, note, x, 10,
                this.client.world == null ? Theme.TEXT_OFF : Theme.TEXT_DIM);
    }

    @Override
    public Text getHint() {
        return Text.translatable("viewmodel.hint.sliders");
    }

    @Override
    public void resetPage() {
        config().mainHand.reset();
        config().offHand.reset();
    }
}
