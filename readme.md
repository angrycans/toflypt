"FlyPT Mover 增强型数据传输协议 (V1.3)
1. 协议定义
帧头 (Header)： 0xAA 0x55 (2 字节，常用于嵌入式同步)。

长度 (Length)： 0x24 (1 字节，十进制 36，代表 Payload 长度)。

有效负载 (Payload)： 36 字节 (9 个 Float32)。

校验 (Checksum)： 1 字节 (从 Payload 开始到 Payload 结束的所有字节累加和取低 8 位)。

帧尾 (Footer)： 0x0D 0x0A (2 字节，即 ASCII 的回车换行 \r\n)。

总报文长度： 2 (头) + 1 (长度) + 36 (数据) + 1 (校验) + 2 (尾) = 42 字节。"					
偏移 (Byte)	字段名 (Field)	长度	类型	单位	说明
0	Frame Header	2	Uint16	-	固定为 0xAA 0x55
2	Data Length	1	Uint8	-	固定为 0x24 (即十进制 36)
3	Sway Acc	4	Float32	 (m/s^2)	横向加速度 (校验和起始点)
7	Surge Acc	4	Float32	 (m/s^2)	纵向加速度
11	Heave Acc	4	Float32	 (m/s^2)	垂向加速度
15	Roll Pos	4	Float32	(度)	横滚角位置
19	Pitch Pos	4	Float32	(度)	俯仰角位置
23	Yaw Pos	4	Float32	(度)	偏航角位置
27	Roll Speed	4	Float32	(度/秒)	横滚角速度
31	Pitch Speed	4	Float32	(度/秒)	俯仰角速度
35	Yaw Speed	4	Float32	(度/秒)	偏航角速度 (校验和结束点)
39	Checksum	1	Uint8	-	偏移 3 至 38 字节的累加和
40	Frame Footer	2	Uint16	-	固定为 0x0D 0x0A (即 \r\n)