我的 mavlink imu 定义是

//26
typedef struct \_\_mavlink*scaled_imu_t {
uint32_t time_boot_ms; /*< [ms] Timestamp (time since system boot)._/
int16_t xacc; /_< [mG] X acceleration*/
int16_t yacc; /*< [mG] Y acceleration*/
int16_t zacc; /*< [mG] Z acceleration*/
int16_t xgyro; /*< [mrad/s] Angular speed around X axis*/
int16_t ygyro; /*< [mrad/s] Angular speed around Y axis*/
int16_t zgyro; /*< [mrad/s] Angular speed around Z axis*/
int16_t xmag; /*< [mgauss] X Magnetic field*/
int16_t ymag; /*< [mgauss] Y Magnetic field*/
int16_t zmag; /*< [mgauss] Z Magnetic field*/
int16_t temperature; /*< [cdegC] Temperature, 0: IMU does not provide temperature values. If the IMU is at 0C it must send 1 (0.01C)._/
int16_t daoYaw; /_< [0.1deg] 双天线传感器 1 角度\_/
} mavlink_scaled_imu_t;

//30
typedef struct \_\_mavlink*attitude_t {
uint32_t time_boot_ms; /*< [ms] Timestamp (time since system boot)._/
float roll; /_< [rad] Roll angle (-pi..+pi)_/
float pitch; /_< [rad] Pitch angle (-pi..+pi)_/
float yaw; /_< [rad] Yaw angle (-pi..+pi)_/
float rollspeed; /_< [rad/s] Roll angular speed*/
float pitchspeed; /*< [rad/s] Pitch angular speed*/
float yawspeed; /*< [rad/s] Yaw angular speed\_/
} mavlink_attitude_t;

//31
typedef struct \_\_mavlink*attitude_quaternion_t {
uint32_t time_boot_ms; /*< [ms] Timestamp (time since system boot)._/
float q1; /_< Quaternion component 1, w (1 in null-rotation)_/
float q2; /_< Quaternion component 2, x (0 in null-rotation)_/
float q3; /_< Quaternion component 3, y (0 in null-rotation)_/
float q4; /_< Quaternion component 4, z (0 in null-rotation)_/
float rollspeed; /_< [rad/s] Roll angular speed*/
float pitchspeed; /*< [rad/s] Pitch angular speed*/
float yawspeed; /*< [rad/s] Yaw angular speed*/
float repr_offset_q[4]; /*< Rotation offset by which the attitude quaternion and angular speed vector should be rotated for user display (quaternion with [w, x, y, z] order, zero-rotation is [1, 0, 0, 0], send [0, 0, 0, 0] if field not supported). This field is intended for systems in which the reference attitude may change during flight. For example, tailsitters VTOLs rotate their reference attitude by 90 degrees between hover mode and fixed wing mode, thus repr*offset_q is equal to [1, 0, 0, 0] in hover mode and equal to [0.7071, 0, 0.7071, 0] in fixed wing mode.*/
} mavlink_attitude_quaternion_t;

//32
typedef struct \_\_mavlink*local_position_ned_t {
uint32_t time_boot_ms; /*< [ms] Timestamp (time since system boot)._/
float x; /_< [m] X Position*/
float y; /*< [m] Y Position*/
float z; /*< [m] Z Position*/
float vx; /*< [m/s] X Speed*/
float vy; /*< [m/s] Y Speed*/
float vz; /*< [m/s] Z Speed\_/
} mavlink_local_position_ned_t;

//33
typedef struct \_\_mavlink*global_position_int_t {
uint32_t time_boot_ms; /*< [ms] Timestamp (time since system boot)._/
int32_t lat; /_< [degE7] Latitude, expressed*/
int32_t lon; /*< [degE7] Longitude, expressed*/
int32_t alt; /*< [mm] Altitude (MSL). Note that virtually all GPS modules provide both WGS84 and MSL._/
int32_t relative_alt; /_< [mm] Altitude above ground*/
int16_t vx; /*< [cm/s] Ground X Speed (Latitude, positive north)_/
int16_t vy; /_< [cm/s] Ground Y Speed (Longitude, positive east)_/
int16_t vz; /_< [cm/s] Ground Z Speed (Altitude, positive down)_/
uint16_t hdg; /_< [cdeg] Vehicle heading (yaw angle), 0.0..359.99 degrees. If unknown, set to: UINT16*MAX*/
} mavlink_global_position_int_t;

flypt 需要的数据是这些

lateral spped m/s

lateral acceleration m/s2

laeral acc with gravity m/s2

lateral gravity m/s2

longtudinal spped

longtudinal acceleration

longtudinal acc with gravity

longtudinal gravity

vertical spped

vertical acceleration

vertical acc with gravity

vertical gravity

使用 node-mavlink 把这些数据按照 4byte float 转发给 flypt udp 端口 127.0.0.1:8081

///
flypt 需要
lateral acceleration m/s2 °/s
longtudinal acceleration m/s2
vertical acceleration m/s2
yaw speed °/s
roll position °
pitch postion °
