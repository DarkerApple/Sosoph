package dev.sosoph.viewmodel.gui.page;

import dev.sosoph.viewmodel.config.Anchor;
import dev.sosoph.viewmodel.config.ThirdPersonRule;
import dev.sosoph.viewmodel.config.Transform;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.ItemPickerScreen;
import dev.sosoph.viewmodel.gui.Theme;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.CycleRow;
import dev.sosoph.viewmodel.gui.widget.LabelRow;
import dev.sosoph.viewmodel.gui.widget.RuleRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import dev.sosoph.viewmodel.gui.widget.ToggleRow;
import dev.sosoph.viewmodel.gui.widget.ValueSlider;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.CameraType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.network.chat.Component;

/**
 * Per item placement in third person, for example a sword resting on the waist.
 *
 * <p>Two previews: the model box on the right, and the real player behind the menu once
 * the camera is switched to third person.
 */
public class ThirdPersonPage extends ConfigPage {
    private static final int GAP = 6;

    private ThirdPersonRule selected;

    private int previewX;
    private int previewY;
    private int previewWidth;
    private int previewHeight;
    private float previewMouseX;
    private float previewMouseY;

    public ThirdPersonPage(ViewModelScreen screen) {
        super(screen);
    }

    @Override
    public Component getTitle() {
        return Component.translatable("viewmodel.tab.third_person");
    }

    @Override
    public int panelWidth(int available) {
        return Math.min(436, available);
    }

    @Override
    public void init(int x, int y, int width, int height) {
        if (this.selected != null && !config().rules.contains(this.selected)) {
            this.selected = null;
        }
        if (this.selected == null && !config().rules.isEmpty()) {
            this.selected = config().rules.get(0);
        }

        int listWidth = Math.min(116, Math.max(80, width / 3));
        int previewWidth = 104;
        int detailWidth = width - listWidth - previewWidth - GAP * 2;
        if (detailWidth < 150) {
            previewWidth = 0;
            detailWidth = width - listWidth - GAP;
        }

        this.buildRuleList(x, y, listWidth, height);
        this.buildDetails(x + listWidth + GAP, y, detailWidth, height);

        this.previewWidth = previewWidth;
        if (previewWidth > 0) {
            this.previewX = x + listWidth + detailWidth + GAP * 2;
            this.previewY = y;
            this.previewHeight = Math.min(height, 150);
        }
    }

    private void buildRuleList(int x, int y, int width, int height) {
        int buttonHeight = 16;
        int listHeight = height - buttonHeight - 4;

        ScrollPanel list = new ScrollPanel(x, y, width, listHeight, 2);
        for (ThirdPersonRule rule : config().rules) {
            list.add(new RuleRow(list.rowWidth(), rule, () -> this.selected, () -> {
                this.selected = rule;
                this.screen.rebuild();
            }, () -> {
                rule.enabled = !rule.enabled;
                config().invalidate();
            }));
        }
        if (list.isEmpty()) {
            list.add(new LabelRow(list.rowWidth(), Component.translatable("viewmodel.third_person.empty"), true));
        }
        this.screen.addPageWidget(list);

        int half = (width - 4) / 2;
        ActionRow add = new ActionRow(half, Component.translatable("viewmodel.button.add"), this::openItemPicker);
        add.setPosition(x, y + listHeight + 4);
        add.setHeight(buttonHeight);
        this.screen.addPageWidget(add);

        ActionRow remove = new ActionRow(half, Component.translatable("viewmodel.button.remove"), Theme.DANGER, () -> {
            if (this.selected != null) {
                config().removeRule(this.selected);
                this.selected = null;
                this.screen.rebuild();
            }
        });
        remove.setPosition(x + half + 4, y + listHeight + 4);
        remove.setHeight(buttonHeight);
        remove.active = this.selected != null;
        this.screen.addPageWidget(remove);
    }

    private void buildDetails(int x, int y, int width, int height) {
        ScrollPanel panel = new ScrollPanel(x, y, width, height);
        int rowWidth = panel.rowWidth();

        panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.section.camera")));
        panel.add(new CycleRow(rowWidth, Component.translatable("viewmodel.option.camera"),
                () -> cameraName(this.minecraft.options.getCameraType()),
                () -> this.cycleCameraType(1), () -> this.cycleCameraType(-1)));
        panel.addSpacer(4);

        if (this.selected == null) {
            panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.third_person.pick_rule"), true));
            this.screen.addPageWidget(panel);
            return;
        }

        ThirdPersonRule rule = this.selected;
        Transform transform = rule.transform;

        panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.section.placement")));
        panel.add(new CycleRow(rowWidth, Component.translatable("viewmodel.option.anchor"),
                () -> rule.anchor.getDisplayName(),
                () -> {
                    rule.anchor = rule.anchor.next();
                    config().invalidate();
                },
                () -> {
                    rule.anchor = rule.anchor.previous();
                    config().invalidate();
                }));
        panel.add(new ToggleRow(rowWidth, Component.translatable("viewmodel.option.rule_enabled"),
                () -> rule.enabled, value -> {
            rule.enabled = value;
            config().invalidate();
        }));
        panel.add(new ToggleRow(rowWidth, Component.translatable("viewmodel.option.hold_while_in_use"),
                () -> rule.holdWhileInUse, value -> rule.holdWhileInUse = value));
        panel.addSpacer(4);

        panel.add(new LabelRow(rowWidth, Component.translatable("viewmodel.section.offset")));
        panel.add(ValueSlider.position(rowWidth, Component.translatable("viewmodel.option.x"),
                () -> transform.x, value -> transform.x = (float) value));
        panel.add(ValueSlider.position(rowWidth, Component.translatable("viewmodel.option.y"),
                () -> transform.y, value -> transform.y = (float) value));
        panel.add(ValueSlider.position(rowWidth, Component.translatable("viewmodel.option.z"),
                () -> transform.z, value -> transform.z = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Component.translatable("viewmodel.option.pitch"),
                () -> transform.pitch, value -> transform.pitch = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Component.translatable("viewmodel.option.yaw"),
                () -> transform.yaw, value -> transform.yaw = (float) value));
        panel.add(ValueSlider.rotation(rowWidth, Component.translatable("viewmodel.option.roll"),
                () -> transform.roll, value -> transform.roll = (float) value));
        panel.add(ValueSlider.scale(rowWidth, Component.translatable("viewmodel.option.scale"),
                () -> transform.scale, value -> transform.scale = (float) value));
        panel.addSpacer(4);

        panel.add(new ActionRow(rowWidth, Component.translatable("viewmodel.button.preset_waist"), () -> {
            rule.anchor = Anchor.WAIST_RIGHT;
            rule.transform.copyFrom(new Transform(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 25.0F, 0.9F));
            config().invalidate();
        }));
        panel.add(new ActionRow(rowWidth, Component.translatable("viewmodel.button.preset_back"), () -> {
            rule.anchor = Anchor.BACK;
            rule.transform.copyFrom(new Transform(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 135.0F, 1.0F));
            config().invalidate();
        }));
        panel.add(new ActionRow(rowWidth, Component.translatable("viewmodel.button.reset_offsets"), () -> {
            rule.transform.reset();
            config().invalidate();
        }));

        this.screen.addPageWidget(panel);
    }

    private void cycleCameraType(int direction) {
        CameraType[] values = CameraType.values();
        CameraType current = this.minecraft.options.getCameraType();
        int index = (current.ordinal() + direction + values.length) % values.length;
        this.minecraft.options.setCameraType(values[index]);
    }

    private static Component cameraName(CameraType perspective) {
        return Component.translatable("viewmodel.camera." + perspective.name().toLowerCase(java.util.Locale.ROOT));
    }

    private void openItemPicker() {
        this.minecraft.setScreen(new ItemPickerScreen(this.screen, Component.translatable("viewmodel.picker.add_rule"),
                entry -> {
                    ThirdPersonRule rule = new ThirdPersonRule(entry.id(), Anchor.WAIST_RIGHT,
                            new Transform(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 25.0F, 0.9F));
                    config().addRule(rule);
                    this.selected = rule;
                }));
    }

    @Override
    public void extract(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        if (this.previewWidth <= 0) {
            return;
        }
        int right = this.previewX + this.previewWidth;
        int bottom = this.previewY + this.previewHeight;
        graphics.fill(this.previewX, this.previewY, right, bottom, Theme.PREVIEW_BG);
        Compat.border(graphics, this.previewX, this.previewY, this.previewWidth, this.previewHeight,
                Theme.BORDER);

        LocalPlayer player = this.minecraft.player;
        if (player == null) {
            graphics.centeredText(this.font,
                    Component.translatable("viewmodel.preview.needs_world"),
                    this.previewX + this.previewWidth / 2, this.previewY + this.previewHeight / 2 - 4,
                    Theme.TEXT_OFF);
            return;
        }

        // Keep the last angle the mouse chose inside the box, so tuning sliders does not
        // spin the model around.
        if (mouseX >= this.previewX && mouseX < right && mouseY >= this.previewY && mouseY < bottom) {
            this.previewMouseX = mouseX;
            this.previewMouseY = mouseY;
        }

        int size = Math.min(this.previewWidth, this.previewHeight) / 2;
        InventoryScreen.extractEntityInInventoryFollowsMouse(graphics, this.previewX + 2, this.previewY + 2, right - 2, bottom - 2, size,
                0.0625F, this.previewMouseX, this.previewMouseY, player);

        Component label = Component.translatable("viewmodel.preview.model");
        graphics.text(this.font, label,
                this.previewX + (this.previewWidth - this.font.width(label)) / 2, bottom + 4,
                Theme.TEXT_DIM);

        if (this.selected != null) {
            ItemStack held = player.getMainHandItem();
            if (!held.isEmpty() && !held.getItem().equals(ViewModelConfig.itemOf(this.selected.item))) {
                Component hold = Component.translatable("viewmodel.preview.hold_item");
                graphics.text(this.font, hold,
                        this.previewX + (this.previewWidth - this.font.width(hold)) / 2, bottom + 16,
                        Theme.TEXT_OFF);
            }
        }
    }

    @Override
    public Component getHint() {
        return Component.translatable("viewmodel.hint.third_person");
    }

    @Override
    public void resetPage() {
        config().rules.clear();
        config().invalidate();
        this.selected = null;
    }
}
