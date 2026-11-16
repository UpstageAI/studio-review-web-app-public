import { useRef } from "react";
import {
  mergeProps,
  useFocusRing,
  useSlider,
  useSliderThumb,
  VisuallyHidden,
} from "react-aria";
import {
  type SliderState,
  type SliderStateOptions,
  useSliderState,
} from "react-stately";

// 도구 모음의 확대·축소 슬라이더다. 색은 테마 토큰 유틸로 칠해 소비자 테마를 따른다.
function Thumb(props: {
  index: number;
  state: SliderState;
  trackRef: React.RefObject<HTMLDivElement | null>;
  focusProps: ReturnType<typeof useFocusRing>["focusProps"];
}) {
  const { state, trackRef, focusProps, index } = props;
  const inputRef = useRef<React.ElementRef<"input">>(null);
  const { thumbProps, inputProps } = useSliderThumb(
    { index, trackRef, inputRef },
    state,
  );

  return (
    <div
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
      style={{
        left: `${state.getThumbPercent(index) * 100}%`,
      }}
    >
      <div
        {...thumbProps}
        // 위치는 바깥 div가 잡는다. react-aria가 주는 절대 위치 style은 쓰지 않는다.
        style={undefined}
        onMouseDown={(...args) => {
          thumbProps.onMouseDown?.(...args);
        }}
        onPointerDown={(...args) => {
          thumbProps.onPointerDown?.(...args);
        }}
        className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
      >
        <VisuallyHidden>
          <input ref={inputRef} {...mergeProps(inputProps, focusProps)} />
        </VisuallyHidden>
      </div>
    </div>
  );
}

export function Slider(
  props: SliderStateOptions<Array<number>> & { onChangeStart?: () => void },
) {
  const trackRef = useRef<React.ElementRef<"div">>(null);
  const state = useSliderState(props);
  const { groupProps, trackProps } = useSlider(props, state, trackRef);
  const { focusProps } = useFocusRing();

  return (
    <div
      {...groupProps}
      className="relative flex w-full flex-auto touch-none items-center gap-6"
    >
      <div
        {...trackProps}
        onMouseDown={(...args) => {
          trackProps.onMouseDown?.(...args);
          props.onChangeStart?.();
        }}
        onPointerDown={(...args) => {
          trackProps.onPointerDown?.(...args);
          props.onChangeStart?.();
        }}
        ref={trackRef}
        className="relative h-2 w-full rounded-full bg-transparent"
      >
        <div className="flex h-full w-full flex-row items-center">
          {/* 채워진 구간 */}
          <div
            className="h-1 bg-primary"
            style={{
              width: `calc(${state.getThumbPercent(0) * 100}% - 2.5px)`,
              borderRadius: "4px 1px 1px 4px",
              marginRight: "1px",
            }}
          />
          <Thumb
            index={0}
            state={state}
            trackRef={trackRef}
            focusProps={focusProps}
          />
          {/* 남은 구간 */}
          <div
            className="h-1 bg-muted-foreground/35"
            style={{
              width:
                state.getThumbValue(0) === 100
                  ? 0
                  : `calc(${100 - state.getThumbPercent(0) * 100}% - 2.5px)`,
              borderRadius: "1px 4px 4px 1px",
              marginLeft: "1px",
            }}
          />
        </div>
      </div>
    </div>
  );
}
