import { useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, ui } from '../theme';

export type SignatureValue = { width: number; height: number; paths: string[] };

/** Finger signature. Strokes are kept as plain SVG path data ("M x y L x y …"). */
export function SignaturePad({ onChange }: { onChange: (v: SignatureValue | null) => void }) {
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const size = useRef({ width: 320, height: 160 });
  const live = useRef('');
  const done = useRef<string[]>([]);

  const point = (x: number, y: number) => `${Math.round(x)} ${Math.round(y)}`;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        live.current = `M${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        setCurrent(live.current);
      },
      onPanResponderMove: (e) => {
        live.current += ` L${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        setCurrent(live.current);
      },
      onPanResponderRelease: () => {
        if (live.current.includes('L')) {
          done.current = [...done.current, live.current];
          setPaths(done.current);
          onChange({ ...size.current, paths: done.current });
        }
        live.current = '';
        setCurrent('');
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = {
      width: Math.max(50, Math.round(e.nativeEvent.layout.width)),
      height: Math.max(50, Math.round(e.nativeEvent.layout.height)),
    };
  };

  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={onLayout}
        {...responder.panHandlers}
        style={{
          height: 160,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.line,
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
        }}
      >
        <Svg width="100%" height="100%">
          {[...paths, current].filter(Boolean).map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#1A120B"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
        {paths.length === 0 && !current && (
          <Text style={{ position: 'absolute', top: 66, alignSelf: 'center', color: '#9A8E82' }}>
            وقّع هنا بإصبعك
          </Text>
        )}
      </View>
      {paths.length > 0 && (
        <Pressable
          onPress={() => {
            done.current = [];
            setPaths([]);
            onChange(null);
          }}
        >
          <Text style={[ui.muted, { textDecorationLine: 'underline' }]}>مسح التوقيع</Text>
        </Pressable>
      )}
    </View>
  );
}
